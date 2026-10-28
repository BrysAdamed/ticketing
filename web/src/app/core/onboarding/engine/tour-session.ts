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
import { NavigationStart, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';
import { PeekService } from '../../layout/peek/peek';
import { TourAnchorRegistry } from './tour-anchor.registry';
import type { TourResult } from './tour-launcher';
import { Box, fillRoute, isOnPath, spotlightHole, stepLabel, TourPlan } from './tour-logic';
import { TourPopoverComponent } from './tour-popover.component';
import { TourSpotlightComponent } from './tour-spotlight.component';
import { TourDefinition, TourPlacement, TourStep } from './tour.model';

const HOLE_PADDING = 4;
const POPOVER_GAP = HOLE_PADDING + 8;
const ANCHOR_TIMEOUT_MS = 4000;

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

/// One running tour: a full-screen spotlight overlay (SVG mask, transparent CDK backdrop that
/// blocks the page and, through `ShortcutService.isOverlayOpen()`, the global shortcuts) and a
/// popover dialog connected to the current anchor. Created by `TourLauncher` from a lazy chunk.
export class TourSession {
  private readonly document: Document;
  private readonly router: Router;
  private readonly anchors: TourAnchorRegistry;
  private readonly announcer: LiveAnnouncer;
  private readonly reducedMotion: boolean;

  readonly steps: readonly TourStep[];
  readonly index = signal(0);
  readonly step = computed(() => this.steps[this.index()]);
  readonly label = computed(() => stepLabel(this.index(), this.steps.length));
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() === this.steps.length - 1);
  readonly hole = signal<Box | null>(null);
  /// The anchor is being located (navigation, lazy view): the page is dimmed without a hole.
  readonly pending = signal(true);

  private spotlightRef: OverlayRef | null = null;
  private popoverRef: OverlayRef | null = null;
  private popover: ComponentRef<TourPopoverComponent> | null = null;
  private position: FlexibleConnectedPositionStrategy | null = null;
  private element: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private overlayObserver: MutationObserver | null = null;
  private peekWatch: EffectRef | null = null;
  private readonly subscriptions = new Subscription();
  private frame = 0;
  private ownNavigation = false;
  private moveToken = 0;
  private finish: (result: TourResult) => void = () => undefined;
  private ended = false;

  constructor(
    private readonly injector: Injector,
    readonly tour: TourDefinition,
    plan: TourPlan,
    private readonly params: Readonly<Record<string, string>>,
    private readonly returnFocusTo: HTMLElement | null,
  ) {
    this.document = injector.get(DOCUMENT);
    this.router = injector.get(Router);
    this.anchors = injector.get(TourAnchorRegistry);
    this.announcer = injector.get(LiveAnnouncer);
    this.reducedMotion =
      this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.steps = plan.steps;
    if (isDevMode()) {
      for (const step of plan.skipped) {
        console.warn(`Tour "${tour.id}": anchor "${step.anchor}" is missing, step skipped.`);
      }
    }
  }

  run(): Promise<TourResult> {
    const done = new Promise<TourResult>((resolve) => (this.finish = resolve));
    this.openSpotlight();
    this.watchInterruptions();
    void this.goTo(0, 1);
    return done;
  }

  next(): void {
    if (this.isLast()) this.close('completed');
    else void this.goTo(this.index() + 1, 1);
  }

  previous(): void {
    if (!this.isFirst()) void this.goTo(this.index() - 1, -1);
  }

  close(result: TourResult): void {
    if (this.ended) return;
    this.ended = true;
    this.moveToken++;
    cancelAnimationFrame(this.frame);
    this.unobserveAnchor();
    this.overlayObserver?.disconnect();
    this.peekWatch?.destroy();
    this.subscriptions.unsubscribe();
    this.popoverRef?.dispose();
    this.spotlightRef?.dispose();
    if (result !== 'interrupted' && this.returnFocusTo?.isConnected) this.returnFocusTo.focus();
    this.finish(result);
  }

  /// Shows step `target`, or the nearest step in `direction` whose anchor can be found.
  private async goTo(target: number, direction: 1 | -1): Promise<void> {
    const token = ++this.moveToken;
    for (let i = target; i >= 0 && i < this.steps.length; i += direction) {
      this.pending.set(true);
      this.hole.set(null);
      const step = this.steps[i];
      await this.navigateTo(step);
      if (token !== this.moveToken) return;
      const element = await this.anchors.whenAvailable(step.anchor, ANCHOR_TIMEOUT_MS);
      if (token !== this.moveToken) return;
      if (!element) {
        if (isDevMode()) {
          console.warn(`Tour "${this.tour.id}": anchor "${step.anchor}" did not appear, skipped.`);
        }
        continue;
      }
      this.index.set(i);
      this.show(step, element);
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
    const path = fillRoute(step.route, this.params);
    if (isOnPath(this.router.url, path)) return;
    this.ownNavigation = true;
    try {
      await this.router.navigateByUrl(path);
    } finally {
      this.ownNavigation = false;
    }
  }

  private show(step: TourStep, element: HTMLElement): void {
    this.observeAnchor(element);
    element.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: this.reducedMotion ? 'auto' : 'smooth',
    });
    this.measure();
    if (this.popoverRef && this.position) {
      this.position.setOrigin(element).withPositions(positionsFor(step.placement));
      this.popoverRef.updatePosition();
    } else {
      this.openPopover(element, step.placement);
    }
    this.pending.set(false);
    this.announcer.announce(`${this.label()}: ${step.title}`, 'polite');
    this.popover?.instance.focus();
  }

  private openSpotlight(): void {
    this.spotlightRef = createOverlayRef(this.injector, {
      positionStrategy: createGlobalPositionStrategy(this.injector),
      scrollStrategy: createNoopScrollStrategy(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });
    const ref = this.spotlightRef.attach(
      new ComponentPortal(TourSpotlightComponent, null, this.injector),
    );
    ref.setInput('session', this);
    this.subscriptions.add(
      this.spotlightRef.backdropClick().subscribe(() => this.popover?.instance.focus()),
    );
  }

  private openPopover(element: HTMLElement, placement: TourPlacement | undefined): void {
    this.position = createFlexibleConnectedPositionStrategy(this.injector, element)
      .withPositions(positionsFor(placement))
      .withPush(true)
      .withFlexibleDimensions(false)
      .withViewportMargin(8);
    this.popoverRef = createOverlayRef(this.injector, {
      positionStrategy: this.position,
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

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.close('dismissed');
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
    if (!element || !view) return;
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

  /// The tour gives way to the peek panel, to any other modal overlay (one with a backdrop) and to
  /// navigation it did not start itself. Tooltips and toasts don't interrupt it.
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
          if (!this.ownNavigation && !isOnPath(e.url, this.router.url)) this.close('interrupted');
        }),
    );

    const peek = this.injector.get(PeekService);
    let peekWasOpen = untracked(() => peek.isOpen());
    this.peekWatch = effect(
      () => {
        const open = peek.isOpen();
        if (open && !peekWasOpen) untracked(() => this.close('interrupted'));
        peekWasOpen = open;
      },
      { injector: this.injector },
    );

    const container = this.injector.get(OverlayContainer).getContainerElement();
    this.overlayObserver = new MutationObserver((records) => {
      const own = [this.spotlightRef?.hostElement, this.popoverRef?.hostElement];
      const foreignBackdrop = records.some((record) =>
        Array.from(record.addedNodes).some(
          (node) =>
            node instanceof HTMLElement &&
            !own.some((host) => host?.contains(node)) &&
            (node.matches('.cdk-overlay-backdrop') ||
              node.querySelector('.cdk-overlay-backdrop') !== null),
        ),
      );
      if (foreignBackdrop) this.close('interrupted');
    });
    this.overlayObserver.observe(container, { childList: true, subtree: true });
  }
}
