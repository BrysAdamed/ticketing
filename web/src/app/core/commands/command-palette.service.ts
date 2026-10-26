import {
  createBlockScrollStrategy,
  createGlobalPositionStrategy,
  createOverlayRef,
  OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { DOCUMENT } from '@angular/common';
import { inject, Injectable, Injector, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { CommandPaletteComponent } from './command-palette.component';

/// Opens the ⌘K command palette: a 640px CDK overlay at 12vh from the top.
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private overlayRef: OverlayRef | null = null;
  private restoreFocus: HTMLElement | null = null;

  readonly isOpen = signal(false);

  constructor() {
    inject(Router)
      .events.pipe(filter((e) => e instanceof NavigationStart))
      .subscribe(() => this.close(false));
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  open(): void {
    if (this.overlayRef) return;
    this.restoreFocus = this.document.activeElement as HTMLElement | null;
    const overlayRef = createOverlayRef(this.injector, {
      positionStrategy: createGlobalPositionStrategy(this.injector)
        .centerHorizontally()
        .top('12vh'),
      scrollStrategy: createBlockScrollStrategy(this.injector),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-dark-backdrop',
    });
    const ref = overlayRef.attach(
      new ComponentPortal(CommandPaletteComponent, null, this.injector),
    );
    ref.instance.closed.subscribe(() => this.close());
    overlayRef.backdropClick().subscribe(() => this.close());
    this.overlayRef = overlayRef;
    this.isOpen.set(true);
  }

  close(restoreFocus = true): void {
    if (!this.overlayRef) return;
    this.overlayRef.dispose();
    this.overlayRef = null;
    this.isOpen.set(false);
    if (restoreFocus) this.restoreFocus?.focus?.();
    this.restoreFocus = null;
  }
}
