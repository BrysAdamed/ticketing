import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  ConnectedPosition,
  createFlexibleConnectedPositionStrategy,
  createGlobalPositionStrategy,
  createNoopScrollStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  FlexibleConnectedPositionStrategy,
  OverlayContainer,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import {
  ComponentRef,
  computed,
  effect,
  EffectRef,
  Injector,
  isDevMode,
  signal,
  untracked,
} from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { debounceTime, filter, merge, Subject, Subscription } from 'rxjs';
import { PeekService } from '../../layout/peek/peek';
import { openBackdrops } from '../hints/hint-logic';
import { TourAnchorRegistry } from './tour-anchor.registry';
import type { TourConditions } from './tour-conditions';
import type { TourResult } from './tour-launcher';
import {
  Box,
  fillRoute,
  fillText,
  isActionStep,
  isOnPath,
  resumeIndex,
  spotlightHole,
  stageProgress,
  stepLabel,
  tryFillRoute,
  TourPlan,
} from './tour-logic';
import { TourPillComponent } from './tour-pill.component';
import { TourPopoverComponent } from './tour-popover.component';
import { TourSpotlightComponent } from './tour-spotlight.component';
import { TourDefinition, TourPlacement, TourStep } from './tour.model';

const HOLE_PADDING = 4;
const POPOVER_GAP = HOLE_PADDING + 8;
const ANCHOR_TIMEOUT_MS = 4000;
const CHECK_DEBOUNCE_MS = 150;

const POSITIONS: Readonly<Record<TourPlacement, readonly ConnectedPosition[]>> = {
  below: [
    {
      originX: 'start',
      originY: 'bottom',
      overlayX: 'start',
      overlayY: 'top',
      offsetY: POPOVER_GAP,
    },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: POPOVER_GAP },
  ],
  above: [
    {
      originX: 'start',
      originY: 'top',
      overlayX: 'start',
      overlayY: 'bottom',
      offsetY: -POPOVER_GAP,
    },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -POPOVER_GAP },
  ],
  end: [
    {
      originX: 'end',
      originY: 'center',
      overlayX: 'start',
      overlayY: 'center',
      offsetX: POPOVER_GAP,
    },
  ],
  start: [
    {
      originX: 'start',
      originY: 'center',
      overlayX: 'end',
      overlayY: 'center',
      offsetX: -POPOVER_GAP,
    },
  ],
};

export function positionsFor(placement: TourPlacement = 'below'): ConnectedPosition[] {
  const order: TourPlacement[] = [placement, 'below', 'above', 'end', 'start'];
  return [...new Set(order)].flatMap((p) => POSITIONS[p]);
}

export interface TourSessionOptions {
  readonly conditions?: TourConditions;
  readonly resume?: { readonly skipOptional?: boolean };
  readonly onPausedChange?: (paused: boolean) => void;
}

/// One running tour: a full-screen spotlight overlay and a popover card connected to the current
/// anchor. A modal step (Next-driven) puts a transparent CDK backdrop under the spotlight, which
/// blocks the page and, through `ShortcutService.isOverlayOpen()`, the global shortcuts, and traps
/// focus in the card. An action-driven step (`advanceWhen`, D-140) has no backdrop: the dimmed area
/// swallows clicks but the hole lets them through, shortcuts stay live, and the step moves on when
/// its condition holds. A walkthrough pauses (a "Continue the walkthrough" pill) where a tour would
/// end on foreign navigation. Created by `TourLauncher` from a lazy chunk.
export class TourSession {
  private readonly document: Document;
  private readonly router: Router;
  private readonly anchors: TourAnchorRegistry;
  private readonly announcer: LiveAnnouncer;
  private readonly peek: PeekService;
  private readonly reducedMotion: boolean;
  private readonly conditions: TourConditions | null;

  readonly steps: readonly TourStep[];
  readonly walkthrough: boolean;
  readonly index = signal(0);
  readonly step = computed(() => this.steps[this.index()]);
  readonly params = signal<Readonly<Record<string, string>>>({});
  readonly isAction = computed(() => isActionStep(this.step()));
  readonly title = computed(() => fillText(this.step().title, this.params()));
  readonly body = computed(() => fillText(this.step().body, this.params()));
  readonly waiting = computed(() => fillText(this.step().waiting ?? '', this.params()));
  readonly actionLabel = computed(() => {
    const action = this.step().action;
    return action ? fillText(action.label, this.params()) : null;
  });
  readonly progress = computed(() => stageProgress(this.steps, this.index()));
  readonly label = computed(() => stepLabel(this.progress().current, this.progress().total));
  readonly dots = computed(() =>
    Array.from({ length: this.progress().total }, (_, i) => i === this.progress().current),
  );
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() === this.steps.length - 1);
  readonly canGoBack = computed(() => {
    const i = this.index();
    return i > 0 && !this.isAction() && !isActionStep(this.steps[i - 1]);
  });
  readonly hole = signal<Box | null>(null);
  /// The anchor is being located (navigation, lazy view): the page is dimmed without a hole.
  readonly pending = signal(true);
  /// An action-driven step gives way to the user's dialog, picker or peek while it is open.
  readonly covered = signal(false);
  /// A walkthrough is between pages after a navigation it did not start.
  readonly navigating = signal(false);
  readonly hidden = computed(() => this.covered() || this.navigating());
  readonly paused = signal(false);
  /// Whether the spotlight currently blocks the page (a modal step).
  readonly modal = signal(true);

  private known: Record<string, string>;
  private spotlightRef: OverlayRef | null = null;
  private popoverRef: OverlayRef | null = null;
  private pillRef: OverlayRef | null = null;
  private popover: ComponentRef<TourPopoverComponent> | null = null;
  private position: FlexibleConnectedPositionStrategy | null = null;
  private popoverAnchored = true;
  private element: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private overlayObserver: MutationObserver | null = null;
  private coverObserver: MutationObserver | null = null;
  private peekWatch: EffectRef | null = null;
  private anchorWatch: EffectRef | null = null;
  private readonly subscriptions = new Subscription();
  private stepWatch = new Subscription();
  private readonly uncovered = new Subject<void>();
  private frame = 0;
  private ownNavigation = false;
  private moveToken = 0;
  private inflight: Promise<boolean> | null = null;
  private checkAgain = false;
  private finish: (result: TourResult) => void = () => undefined;
  private ended = false;

  constructor(
    private readonly injector: Injector,
    readonly tour: TourDefinition,
    plan: TourPlan,
    params: Readonly<Record<string, string>>,
    private readonly returnFocusTo: HTMLElement | null,
    private readonly options: TourSessionOptions = {},
  ) {
    this.document = injector.get(DOCUMENT);
    this.router = injector.get(Router);
    this.anchors = injector.get(TourAnchorRegistry);
    this.announcer = injector.get(LiveAnnouncer);
    this.peek = injector.get(PeekService);
    this.conditions = options.conditions ?? null;
    this.walkthrough = tour.kind === 'walkthrough';
    this.reducedMotion =
      this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.steps = plan.steps;
    this.known = { ...params };
    this.params.set(this.known);
    if (isDevMode()) {
      for (const step of plan.skipped) {
        console.warn(`Tour "${tour.id}": anchor "${step.anchor}" is missing, step skipped.`);
      }
    }
  }

  run(): Promise<TourResult> {
    const done = new Promise<TourResult>((resolve) => (this.finish = resolve));
    if (this.options.resume) {
      this.openSpotlight(false);
      this.watchInterruptions();
      void this.resumeFrom(0, this.options.resume.skipOptional ?? false);
    } else {
      this.openSpotlight(!isActionStep(this.steps[0]));
      this.watchInterruptions();
      void this.goTo(0, 1);
    }
    return done;
  }

  next(): void {
    if (this.isAction()) return;
    if (this.isLast()) this.close('completed');
    else void this.goTo(this.index() + 1, 1);
  }

  previous(): void {
    if (this.canGoBack()) void this.goTo(this.index() - 1, -1);
  }

  /// Passes over an optional action-driven step.
  skipStep(): void {
    if (this.step().optional) void this.goTo(this.index() + 1, 1);
  }

  /// The step's own button: clicks or focuses the anchor, or runs the custom action.
  async runAction(): Promise<void> {
    const action = this.step().action;
    if (!action) return;
    const anchor = this.anchors.get(this.step().anchor) ?? this.element;
    if (action.does === 'click-anchor') {
      anchor?.click();
    } else if (action.does === 'focus-anchor') {
      focusable(anchor)?.focus();
    } else {
      if (!this.conditions) return;
      const token = this.moveToken;
      const learnt = await this.conditions.run(action.id, this.known);
      if (token !== this.moveToken || this.ended) return;
      if (learnt) this.learn(learnt);
      const advanced = await this.checkNow();
      if (!advanced && !this.covered()) this.popover?.instance.focus();
    }
  }

  focusCard(): void {
    this.popover?.instance.focus();
  }

  close(result: TourResult): void {
    if (this.ended) return;
    this.ended = true;
    this.moveToken++;
    cancelAnimationFrame(this.frame);
    this.unobserveAnchor();
    this.overlayObserver?.disconnect();
    this.coverObserver?.disconnect();
    this.peekWatch?.destroy();
    this.anchorWatch?.destroy();
    this.stepWatch.unsubscribe();
    this.subscriptions.unsubscribe();
    this.disposeCard();
    this.pillRef?.dispose();
    this.pillRef = null;
    if (this.paused()) {
      this.paused.set(false);
      this.options.onPausedChange?.(false);
    }
    if (result !== 'interrupted' && this.returnFocusTo?.isConnected) this.returnFocusTo.focus();
    this.finish(result);
  }

  /// A walkthrough's user went elsewhere: the card and spotlight go, a pill offers to continue.
  pause(): void {
    if (this.ended || this.paused()) return;
    this.moveToken++;
    this.stepWatch.unsubscribe();
    this.unobserveAnchor();
    this.disposeCard();
    this.navigating.set(false);
    this.covered.set(false);
    this.paused.set(true);
    this.options.onPausedChange?.(true);
    this.openPill();
    this.announcer.announce(`${this.tour.title} paused. Continue the walkthrough when ready.`);
  }

  /// Continues a paused walkthrough at the first step not done yet, from where it paused.
  resume(): void {
    if (this.ended || !this.paused()) return;
    this.pillRef?.dispose();
    this.pillRef = null;
    this.paused.set(false);
    this.options.onPausedChange?.(false);
    this.openSpotlight(!this.isAction());
    void this.resumeFrom(this.index(), false);
  }

  private async resumeFrom(from: number, skipOptional: boolean): Promise<void> {
    const token = ++this.moveToken;
    this.pending.set(true);
    const holds: boolean[] = [];
    for (let i = from; i < this.steps.length; i++) {
      const step = this.steps[i];
      const ok = isActionStep(step) && (await this.evaluate(step));
      if (token !== this.moveToken || this.ended) return;
      holds.push(ok);
    }
    const target = from + resumeIndex(this.steps.slice(from), holds, { skipOptional });
    if (target >= this.steps.length) {
      this.close('completed');
      return;
    }
    if (this.moveToken === token) void this.goTo(target, 1);
  }

  /// Shows step `target`, or the nearest step in `direction` whose anchor can be found. An
  /// action-driven step whose anchor is missing still shows, as a card at the bottom of the page.
  private async goTo(target: number, direction: 1 | -1): Promise<void> {
    const token = ++this.moveToken;
    this.stepWatch.unsubscribe();
    for (let i = target; i >= 0 && i < this.steps.length; i += direction) {
      const step = this.steps[i];
      this.pending.set(true);
      this.hole.set(null);
      this.setModal(!isActionStep(step));
      await this.navigateTo(step);
      if (token !== this.moveToken) return;
      const element = await this.anchors.whenAvailable(step.anchor, ANCHOR_TIMEOUT_MS);
      if (token !== this.moveToken) return;
      if (!element && !isActionStep(step)) {
        if (isDevMode()) {
          console.warn(`Tour "${this.tour.id}": anchor "${step.anchor}" did not appear, skipped.`);
        }
        continue;
      }
      this.index.set(i);
      this.show(step, element);
      if (isActionStep(step)) this.watchStep();
      return;
    }
    if (direction === 1) {
      this.close(this.popover ? 'completed' : 'aborted');
    } else {
      this.pending.set(false);
      this.measure();
    }
  }

  private async navigateTo(step: TourStep): Promise<void> {
    if (!step.route) return;
    const path = fillRoute(step.route, this.known);
    if (isOnPath(this.router.url, path)) return;
    this.ownNavigation = true;
    try {
      await this.router.navigateByUrl(path);
    } finally {
      this.ownNavigation = false;
    }
  }

  private show(step: TourStep, element: HTMLElement | null): void {
    if (element) {
      this.observeAnchor(element);
      element.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
        behavior: this.reducedMotion ? 'auto' : 'smooth',
      });
    } else {
      this.unobserveAnchor();
    }
    this.measure();
    if (this.popoverRef && this.popoverAnchored !== (element !== null)) this.disposePopover();
    if (this.popoverRef && this.position && element) {
      this.position.setOrigin(element).withPositions(positionsFor(step.placement));
      this.popoverRef.updatePosition();
    } else if (!this.popoverRef) {
      this.openPopover(element, step.placement);
    }
    this.pending.set(false);
    this.announcer.announce(`${this.label()}: ${this.title()}`, 'polite');
    this.popover?.instance.focus();
  }

  /// Checks the step's condition when the state may have changed: on start, after a write or a
  /// focus (`TourConditions.changes`), after a navigation and when the user's dialog closes.
  private watchStep(): void {
    this.stepWatch = new Subscription();
    const triggers = merge(this.conditions?.changes ?? new Subject<unknown>(), this.uncovered);
    this.stepWatch.add(
      triggers.pipe(debounceTime(CHECK_DEBOUNCE_MS)).subscribe(() => void this.checkNow()),
    );
    void this.checkNow();
  }

  /// Resolves true when the current action-driven step's condition held and the tour moved on.
  private checkNow(): Promise<boolean> {
    if (this.inflight) {
      this.checkAgain = true;
      return this.inflight;
    }
    this.inflight = this.checkOnce().finally(() => {
      this.inflight = null;
      if (this.checkAgain) {
        this.checkAgain = false;
        void this.checkNow();
      }
    });
    return this.inflight;
  }

  private async checkOnce(): Promise<boolean> {
    const step = this.step();
    if (this.ended || this.paused() || !isActionStep(step)) return false;
    const token = this.moveToken;
    const index = this.index();
    const holds = await this.evaluate(step);
    if (!holds || token !== this.moveToken || this.ended || this.paused()) return false;
    this.announcer.announce(`Done: ${this.title()}`, 'polite');
    if (index === this.steps.length - 1) this.close('completed');
    else void this.goTo(index + 1, 1);
    return true;
  }

  /// Whether an action-driven step is done; learns the params its condition reports.
  private async evaluate(step: TourStep): Promise<boolean> {
    const advance = step.advanceWhen;
    if (!advance) return false;
    if (advance.kind === 'route') {
      const path = tryFillRoute(advance.path, this.known);
      return path !== null && isOnPath(this.router.url, path);
    }
    if (!this.conditions) return false;
    const result = await this.conditions.check(advance.id, this.known);
    if (result.holds && result.params) this.learn(result.params);
    return result.holds;
  }

  private learn(params: Readonly<Record<string, string>>): void {
    this.known = { ...this.known, ...params };
    this.params.set(this.known);
  }

  private setModal(modal: boolean): void {
    if (this.modal() === modal && this.spotlightRef) return;
    this.disposeCard();
    this.openSpotlight(modal);
  }

  private openSpotlight(modal: boolean): void {
    this.spotlightRef?.dispose();
    this.modal.set(modal);
    this.spotlightRef = createOverlayRef(this.injector, {
      positionStrategy: createGlobalPositionStrategy(this.injector),
      scrollStrategy: createNoopScrollStrategy(),
      hasBackdrop: modal,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });
    const ref = this.spotlightRef.attach(
      new ComponentPortal(TourSpotlightComponent, null, this.injector),
    );
    ref.setInput('session', this);
    if (modal) {
      const spotlight = this.spotlightRef;
      this.subscriptions.add(
        spotlight.backdropClick().subscribe(() => this.popover?.instance.focus()),
      );
    }
  }

  private openPopover(element: HTMLElement | null, placement: TourPlacement | undefined): void {
    this.popoverAnchored = element !== null;
    if (element) {
      this.position = createFlexibleConnectedPositionStrategy(this.injector, element)
        .withPositions(positionsFor(placement))
        .withPush(true)
        .withFlexibleDimensions(false)
        .withViewportMargin(8);
    } else {
      this.position = null;
    }
    this.popoverRef = createOverlayRef(this.injector, {
      positionStrategy:
        this.position ??
        createGlobalPositionStrategy(this.injector).centerHorizontally().bottom('24px'),
      scrollStrategy: createRepositionScrollStrategy(this.injector),
      panelClass: 'tk-tour-popover-pane',
    });
    this.popover = this.popoverRef.attach(
      new ComponentPortal(TourPopoverComponent, null, this.injector),
    );
    this.popover.setInput('session', this);
    this.subscriptions.add(
      this.popoverRef.keydownEvents().subscribe((event) => this.onKeydown(event)),
    );
  }

  private openPill(): void {
    this.pillRef = createOverlayRef(this.injector, {
      positionStrategy: createGlobalPositionStrategy(this.injector)
        .centerHorizontally()
        .bottom('20px'),
      scrollStrategy: createNoopScrollStrategy(),
      panelClass: 'tk-tour-pill-pane',
    });
    const ref = this.pillRef.attach(new ComponentPortal(TourPillComponent, null, this.injector));
    ref.setInput('session', this);
  }

  private disposePopover(): void {
    this.popoverRef?.dispose();
    this.popoverRef = null;
    this.popover = null;
    this.position = null;
  }

  private disposeCard(): void {
    this.disposePopover();
    this.spotlightRef?.dispose();
    this.spotlightRef = null;
  }

  private onKeydown(event: KeyboardEvent): void {
    if (this.isAction()) {
      if (event.key !== 'Escape' || isEditable(event.target)) return;
      this.close('dismissed');
    } else if (event.key === 'Escape') this.close('dismissed');
    else if (event.key === 'ArrowRight' && !this.pending() && !this.isLast()) this.next();
    else if (event.key === 'ArrowLeft' && !this.pending()) this.previous();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  private observeAnchor(element: HTMLElement): void {
    this.unobserveAnchor();
    this.element = element;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
      this.resizeObserver.observe(element);
      this.resizeObserver.observe(this.document.documentElement);
    }
  }

  private unobserveAnchor(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element = null;
  }

  private scheduleMeasure(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  }

  private measure(): void {
    const element = this.element;
    const view = this.document.defaultView;
    if (!element || !view || this.paused() || this.navigating()) return;
    if (!element.isConnected) {
      void this.goTo(this.index(), 1);
      return;
    }
    const rect = element.getBoundingClientRect();
    this.hole.set(
      spotlightHole(
        { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        { width: view.innerWidth, height: view.innerHeight },
        HOLE_PADDING,
      ),
    );
    this.popoverRef?.updatePosition();
  }

  /// A tour gives way to the peek panel, to any other modal overlay (one with a backdrop) and to
  /// navigation it did not start itself; a walkthrough pauses instead. An action-driven step only
  /// hides while the user's own overlay or the peek is open, and checks its condition when a
  /// navigation lands. Tooltips and toasts don't interrupt either.
  private watchInterruptions(): void {
    const view = this.document.defaultView;
    const onViewportChange = () => this.scheduleMeasure();
    view?.addEventListener('resize', onViewportChange, { passive: true });
    this.document.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
    this.subscriptions.add(() => {
      view?.removeEventListener('resize', onViewportChange);
      this.document.removeEventListener('scroll', onViewportChange, { capture: true });
    });

    this.subscriptions.add(
      this.router.events
        .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
        .subscribe((e) => {
          if (this.ownNavigation || this.paused() || isOnPath(e.url, this.router.url)) return;
          if (this.walkthrough) this.navigating.set(true);
          else this.close('interrupted');
        }),
    );
    if (this.walkthrough) {
      this.subscriptions.add(
        this.router.events
          .pipe(
            filter(
              (e) =>
                e instanceof NavigationEnd ||
                e instanceof NavigationCancel ||
                e instanceof NavigationError,
            ),
          )
          .subscribe(() => {
            if (this.ownNavigation || !this.navigating()) return;
            void this.landed();
          }),
      );
    }

    let peekWasOpen = untracked(() => this.peek.isOpen());
    this.peekWatch = effect(
      () => {
        const open = this.peek.isOpen();
        const opened = open && !peekWasOpen;
        peekWasOpen = open;
        untracked(() => {
          if (this.isAction()) this.refreshCovered();
          else if (opened) this.giveWay();
        });
      },
      { injector: this.injector },
    );

    this.anchorWatch = effect(
      () => {
        const element = this.anchors.get(this.step().anchor);
        untracked(() => this.followAnchor(element));
      },
      { injector: this.injector },
    );

    const container = this.injector.get(OverlayContainer).getContainerElement();
    this.overlayObserver = new MutationObserver((records) => {
      if (this.isAction() || this.paused()) return;
      const own = [
        this.spotlightRef?.hostElement,
        this.spotlightRef?.backdropElement,
        this.popoverRef?.hostElement,
      ];
      const foreignBackdrop = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof HTMLElement &&
            !own.some((host) => host?.contains(node)) &&
            (node.matches('.cdk-overlay-backdrop') ||
              node.querySelector('.cdk-overlay-backdrop') !== null),
        ),
      );
      if (foreignBackdrop) this.giveWay();
    });
    this.overlayObserver.observe(container, { childList: true, subtree: true });

    if (this.steps.some(isActionStep)) {
      this.coverObserver = new MutationObserver(() => {
        if (this.isAction()) this.refreshCovered();
      });
      this.coverObserver.observe(this.document.body, { childList: true, subtree: true });
    }
  }

  /// The view re-rendered the current anchor (a list refresh): the hole and the card follow it.
  private followAnchor(element: HTMLElement | null): void {
    if (!element || !this.element || element === this.element || this.pending()) return;
    this.observeAnchor(element);
    this.position?.setOrigin(element);
    this.measure();
  }

  private giveWay(): void {
    if (this.walkthrough) this.pause();
    else this.close('interrupted');
  }

  /// After a navigation the walkthrough did not start: done → next step; still on the step's
  /// page → carry on; elsewhere → pause.
  private async landed(): Promise<void> {
    const token = this.moveToken;
    const advanced = this.isAction() ? await this.checkNow() : false;
    this.navigating.set(false);
    if (advanced || token !== this.moveToken || this.ended || this.paused()) return;
    const route = this.step().route;
    const path = route ? tryFillRoute(route, this.known) : null;
    if (path && !isOnPath(this.router.url, path)) this.pause();
    else void this.goTo(this.index(), 1);
  }

  private refreshCovered(): void {
    if (this.paused() || this.ended) return;
    const own = this.spotlightRef?.backdropElement;
    const covered =
      this.peek.isOpen() || openBackdrops(this.document).some((backdrop) => backdrop !== own);
    if (covered === this.covered()) return;
    this.covered.set(covered);
    if (!covered) {
      this.scheduleMeasure();
      this.uncovered.next();
    }
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function focusable(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  if (element.matches('button, a[href], input, textarea, select, [tabindex]')) return element;
  return element.querySelector<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
  );
}
