import { Injectable, signal } from '@angular/core';

/// Which tour is on screen. `TourLauncher` sets it; code that only needs to wait for a tour (the
/// auto-shown dialogs) reads it here without pulling the launcher into the initial bundle.
@Injectable({ providedIn: 'root' })
export class ActiveTour {
  /// Id of the running tour, or null.
  readonly id = signal<string | null>(null);
}
