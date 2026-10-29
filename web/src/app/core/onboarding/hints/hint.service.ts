import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { TourLauncher } from '../engine/tour-launcher';
import { HintDefinition } from '../guides/hints';
import { OnboardingStateService } from '../onboarding-state.service';
import { isCoveredByOverlay, openBackdrops, visibleHint } from './hint-logic';

interface HintSlot {
  readonly token: number;
  readonly hint: HintDefinition;
  readonly element: Element;
  readonly canWrite: () => boolean;
}

/// Decides which contextual hint (spec 14.5) shows: at most one per page, the first registered
/// that the user has not dismissed at its version, may see and that no dialog, menu, picker or tour
/// step covers. Waits for the onboarding state; dismissing records `Dismissed`.
@Injectable({ providedIn: 'root' })
export class HintService {
  private readonly onboarding = inject(OnboardingStateService);
  private readonly tours = inject(TourLauncher);
  private readonly document = inject(DOCUMENT);
  private readonly slots = signal<readonly HintSlot[]>([]);
  private readonly backdrops = signal<readonly Element[]>([], {
    equal: (a, b) => a.length === b.length && a.every((element, i) => element === b[i]),
  });
  private observer: MutationObserver | null = null;
  private nextToken = 1;

  /// Token of the hint on screen, or null.
  readonly visible = computed(() => {
    const backdrops = this.backdrops();
    return visibleHint(
      this.slots().map((slot) => ({
        token: slot.token,
        hint: slot.hint,
        canWrite: slot.canWrite(),
        coveredByOverlay: isCoveredByOverlay(slot.element, backdrops),
      })),
      {
        loaded: this.onboarding.loaded(),
        tourRunning: this.tours.running() !== null,
        isSeen: (id, version) => this.onboarding.isSeen(id, version),
      },
    );
  });

  /// Adds a place that may show `hint`; returns its token and a function that removes it.
  register(
    hint: HintDefinition,
    element: Element,
    canWrite: () => boolean,
  ): { token: number; unregister: () => void } {
    const slot: HintSlot = { token: this.nextToken++, hint, element, canWrite };
    this.slots.update((slots) => [...slots, slot]);
    this.watchOverlays();
    return {
      token: slot.token,
      unregister: () => {
        this.slots.update((slots) => slots.filter((s) => s !== slot));
        if (this.slots().length === 0) this.unwatchOverlays();
      },
    };
  }

  dismiss(hint: HintDefinition): Promise<boolean> {
    return this.onboarding.dismiss(hint.id, hint.version);
  }

  /// Overlays may be popovers next to their origin rather than in the overlay container, so the
  /// whole document is watched, only while a hint is registered.
  private watchOverlays(): void {
    if (this.observer) return;
    const refresh = () => this.backdrops.set(openBackdrops(this.document));
    this.observer = new MutationObserver(refresh);
    this.observer.observe(this.document.body, { childList: true, subtree: true });
    refresh();
  }

  private unwatchOverlays(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.backdrops.set([]);
  }
}
