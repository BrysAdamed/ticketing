import { inject, Injectable, Injector, signal } from '@angular/core';
import { TourTargetKind } from './tours/tour-catalogue';

/// Something a tour opens to start away from its view.
export interface TourTarget {
  readonly url: string;
  /// The project the target lives in, when its view opens one.
  readonly projectKey?: string;
}

/// What the tours that start on a ticket, a board or a regression session open when they start
/// elsewhere (D-170). `prepare` looks one up (`findTourTarget`, a lazy chunk); callers do so when
/// they show a learn action. `get` is reactive and null until something was found. Eager and tiny.
@Injectable({ providedIn: 'root' })
export class TourTargets {
  private readonly injector = inject(Injector);
  private readonly found = signal<ReadonlyMap<TourTargetKind, TourTarget>>(new Map());

  get(kind: TourTargetKind): TourTarget | null {
    return this.found().get(kind) ?? null;
  }

  async prepare(kind: TourTargetKind): Promise<TourTarget | null> {
    let target: TourTarget | null;
    try {
      const { findTourTarget } = await import('./tour-target-finder');
      target = await findTourTarget(this.injector, kind);
    } catch {
      target = null;
    }
    this.found.update((map) => {
      const next = new Map(map);
      if (target) next.set(kind, target);
      else next.delete(kind);
      return next;
    });
    return target;
  }
}
