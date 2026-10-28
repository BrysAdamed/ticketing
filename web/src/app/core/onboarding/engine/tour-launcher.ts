import { DOCUMENT } from '@angular/common';
import { inject, Injectable, Injector } from '@angular/core';
import { ActiveTour } from './active-tour';
import { NavigationContext } from '../../layout/navigation-context';
import { PeekService } from '../../layout/peek/peek';
import { planTour } from './tour-logic';
import { TourAnchorRegistry } from './tour-anchor.registry';
import { TourAccess, TourDefinition } from './tour.model';
import type { TourSession } from './tour-session';

export interface TourStartOptions {
  readonly access: TourAccess;
  /// Values for `:param` placeholders in step routes.
  readonly params?: Readonly<Record<string, string>>;
  /// Where focus goes when the tour ends; defaults to the element focused when it started.
  readonly returnFocusTo?: HTMLElement | null;
}

/// How a tour ended: `completed` (Done on the last step), `dismissed` (Esc or Skip), `aborted`
/// (too few anchors, nothing to show) or `interrupted` (the peek, another modal overlay or a
/// navigation took over).
export type TourResult = 'completed' | 'dismissed' | 'aborted' | 'interrupted';

/// Starts guided tours. The engine (overlays, focus trap, measuring) is a lazy chunk loaded on the
/// first start, so this service is all the initial bundle carries.
@Injectable({ providedIn: 'root' })
export class TourLauncher {
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly anchors = inject(TourAnchorRegistry);
  private readonly navigation = inject(NavigationContext);
  private readonly peek = inject(PeekService);
  private session: TourSession | null = null;

  /// Id of the running tour, or null.
  readonly running = inject(ActiveTour).id;

  async start(tour: TourDefinition, options: TourStartOptions): Promise<TourResult> {
    this.session?.close('interrupted');
    const params = options.params ?? {};
    const plan = planTour(tour, options.access, {
      url: this.navigation.url(),
      params,
      hasAnchor: (anchor) => this.anchors.has(anchor),
    });
    if (plan.abort) return 'aborted';
    if (this.peek.isOpen()) this.peek.close();
    const returnFocusTo =
      options.returnFocusTo ?? (this.document.activeElement as HTMLElement | null);
    const { TourSession } = await import('./tour-session');
    const session = new TourSession(this.injector, tour, plan, params, returnFocusTo);
    this.session = session;
    this.running.set(tour.id);
    const result = await session.run();
    if (this.session === session) {
      this.session = null;
      this.running.set(null);
    }
    return result;
  }

  stop(): void {
    this.session?.close('dismissed');
  }
}
