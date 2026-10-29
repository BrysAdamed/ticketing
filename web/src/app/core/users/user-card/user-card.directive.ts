import { ConnectedPosition, Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { UserRef } from '@shared/ui/domain/user-display.component';
import { UserCardPopoverComponent } from './user-card-popover.component';

/// How the card opens: `click` (and Enter) where a click on the person does nothing else, `hover`
/// (after `USER_CARD_HOVER_MS`) where the click already has a job, such as editing the assignee.
export type UserCardTrigger = 'click' | 'hover';

/// The same delay as the ticket key's hover tooltip (`MAT_TOOLTIP_DEFAULT_OPTIONS.showDelay`).
export const USER_CARD_HOVER_MS = 500;
const HOVER_LEAVE_MS = 150;

const POSITIONS: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
];

/// Opens the user card (`tk-user-card`, layout-and-screens §2) for a person's name or avatar.
/// `click` makes the host a button that opens it on click or Enter and moves focus in; Esc or a
/// click outside closes it and returns focus. `hover` opens it after 500ms over the host and
/// closes it when the pointer leaves host and card, or on Esc (D-155).
@Directive({
  selector: '[tkUserCard]',
  host: {
    '[attr.role]': 'buttonRole() ? "button" : null',
    '[attr.tabindex]': 'buttonRole() ? 0 : null',
    '[attr.aria-haspopup]': 'clickable() ? "dialog" : null',
    '[attr.aria-expanded]': 'clickable() ? open() : null',
    '[class.tk-user-card-trigger]': 'clickable()',
    '(click)': 'onClick($event)',
    '(pointerdown)': 'onPointerDown()',
    '(keydown)': 'onKeydown($event)',
    '(mouseenter)': 'onEnter()',
    '(mouseleave)': 'onLeave()',
  },
})
export class UserCardDirective {
  private readonly overlay = inject(Overlay);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly user = input<UserRef | null | undefined>(null, { alias: 'tkUserCard' });
  readonly trigger = input<UserCardTrigger>('click', { alias: 'tkUserCardTrigger' });

  protected readonly open = signal(false);
  protected readonly clickable = computed(() => !!this.user() && this.trigger() === 'click');
  protected readonly buttonRole = computed(
    () => this.clickable() && !isNativelyInteractive(this.host.nativeElement),
  );

  private overlayRef: OverlayRef | null = null;
  private subscriptions = new Subscription();
  private enterTimer: ReturnType<typeof setTimeout> | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.clearTimers();
      this.close(false);
    });
  }

  protected onPointerDown(): void {
    if (this.trigger() !== 'hover') return;
    this.clearTimers();
    this.close(false);
  }

  protected onClick(event: MouseEvent): void {
    if (!this.clickable()) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.open()) this.close(true);
    else this.show(true);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.buttonRole() || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    this.show(true);
  }

  protected onEnter(): void {
    if (!this.user() || this.trigger() !== 'hover') return;
    this.cancelLeave();
    if (this.open() || this.enterTimer) return;
    this.enterTimer = setTimeout(() => {
      this.enterTimer = null;
      this.show(false);
    }, USER_CARD_HOVER_MS);
  }

  protected onLeave(): void {
    if (this.trigger() !== 'hover') return;
    if (this.enterTimer) clearTimeout(this.enterTimer);
    this.enterTimer = null;
    this.scheduleLeave();
  }

  private show(byClick: boolean): void {
    const user = this.user();
    if (!user || this.overlayRef) return;
    const overlayRef = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(this.host)
        .withPositions(POSITIONS)
        .withPush(true),
      scrollStrategy: byClick
        ? this.overlay.scrollStrategies.reposition()
        : this.overlay.scrollStrategies.close(),
      hasBackdrop: byClick,
      backdropClass: 'cdk-overlay-transparent-backdrop',
    });
    const ref = overlayRef.attach(
      new ComponentPortal(UserCardPopoverComponent, null, this.injector),
    );
    ref.setInput('user', user);
    ref.setInput('focusOnOpen', byClick);
    this.overlayRef = overlayRef;
    this.open.set(true);
    this.subscriptions = new Subscription();
    this.subscriptions.add(ref.instance.closed.subscribe(() => this.close(false)));
    this.subscriptions.add(overlayRef.backdropClick().subscribe(() => this.close(true)));
    this.subscriptions.add(overlayRef.detachments().subscribe(() => this.close(false)));
    this.subscriptions.add(
      overlayRef.keydownEvents().subscribe((event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        this.close(true);
      }),
    );
    if (!byClick) {
      const pane = overlayRef.overlayElement;
      const enter = () => this.cancelLeave();
      const leave = () => this.scheduleLeave();
      pane.addEventListener('mouseenter', enter);
      pane.addEventListener('mouseleave', leave);
      this.subscriptions.add(() => {
        pane.removeEventListener('mouseenter', enter);
        pane.removeEventListener('mouseleave', leave);
      });
    }
  }

  private close(restoreFocus: boolean): void {
    const overlayRef = this.overlayRef;
    if (!overlayRef) return;
    this.overlayRef = null;
    this.subscriptions.unsubscribe();
    overlayRef.dispose();
    this.open.set(false);
    if (restoreFocus && this.clickable()) this.host.nativeElement.focus();
  }

  private scheduleLeave(): void {
    this.cancelLeave();
    this.leaveTimer = setTimeout(() => {
      this.leaveTimer = null;
      this.close(false);
    }, HOVER_LEAVE_MS);
  }

  private cancelLeave(): void {
    if (this.leaveTimer) clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }

  private clearTimers(): void {
    if (this.enterTimer) clearTimeout(this.enterTimer);
    this.enterTimer = null;
    this.cancelLeave();
  }
}

function isNativelyInteractive(element: HTMLElement): boolean {
  return element.tagName === 'BUTTON' || (element.tagName === 'A' && element.hasAttribute('href'));
}
