import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { TourAccess } from './engine/tour.model';

interface AccessSource {
  readonly viewId: string;
  readonly access: () => TourAccess | null;
}

/// What the user may do on a view that has no open project (a board, a ticket page), as the view
/// itself reports it from what it loaded (D-138). `GuidedTours` prefers it over the open project's
/// role for the tour of that view. Eager and tiny; views call `provide` in their constructor.
@Injectable({ providedIn: 'root' })
export class ViewTourAccess {
  private readonly sources = signal<readonly AccessSource[]>([]);

  /// Reports the access for the tour of `viewId` while the calling component lives. `access` may
  /// return null while it is not known yet (data still loading) or does not apply (a peek).
  provide(viewId: string, access: () => TourAccess | null, destroyRef = inject(DestroyRef)): void {
    const source: AccessSource = { viewId, access };
    this.sources.update((list) => [...list, source]);
    destroyRef.onDestroy(() => this.sources.update((list) => list.filter((s) => s !== source)));
  }

  /// The access the latest source of `viewId` reports, or null when no view reports one.
  get(viewId: string): TourAccess | null {
    const sources = this.sources().filter((s) => s.viewId === viewId);
    for (let i = sources.length - 1; i >= 0; i--) {
      const access = sources[i].access();
      if (access) return access;
    }
    return null;
  }
}
