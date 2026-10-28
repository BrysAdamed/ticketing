import { computed, inject, Injectable, signal } from '@angular/core';
import { OnboardingStateService } from '../onboarding-state.service';
import { CHECKLIST_GUIDE } from '../guides/checklist';
import { checklistProgress, groupChecklist, nextChecklistItem } from './checklist.model';

/// The getting-started checklist card on My work (spec 14.3, D-133). Items come from
/// `GET /me/onboarding`; this service decides whether the card shows: until the user dismisses
/// it or completes every required item. On completion the card shows its completed state for the
/// rest of the visit while `checklist` is stored as Completed, so it does not show again.
/// `restore()` (Help → Getting started) forgets the stored state, so the card shows again.
@Injectable({ providedIn: 'root' })
export class GettingStartedService {
  private readonly onboarding = inject(OnboardingStateService);
  private readonly celebrating = signal(false);
  private readonly focusPending = signal(false);

  readonly items = this.onboarding.checklist;
  readonly groups = computed(() => groupChecklist(this.items()));
  readonly progress = computed(() => checklistProgress(this.items()));
  readonly next = computed(() => nextChecklistItem(this.items()));
  readonly loaded = this.onboarding.loaded;
  /// True until the first state arrives; the card shows a skeleton meanwhile.
  readonly loading = computed(() => {
    const status = this.onboarding.status();
    return status === 'idle' || status === 'loading';
  });
  /// The card is on My work: not yet dismissed or completed, or completed during this visit.
  readonly visible = computed(
    () =>
      this.loaded() &&
      (this.celebrating() || !this.onboarding.isSeen(CHECKLIST_GUIDE.id, CHECKLIST_GUIDE.version)),
  );
  /// The completed state is showing.
  readonly completed = computed(() => this.visible() && this.progress().complete);
  /// The user asked to see the card (Help → Getting started); My work brings it into view and
  /// calls `focusHandled()`.
  readonly focusRequested = this.focusPending.asReadonly();

  /// Refetches the items, for example when My work is shown or the window regains focus.
  refresh(): Promise<void> {
    return this.onboarding.load();
  }

  /// Stores `checklist` Completed once every required item is done; the card keeps showing its
  /// completed state until `hide()` or the next visit.
  acknowledgeCompletion(): void {
    if (!this.progress().complete || this.celebrating()) return;
    this.celebrating.set(true);
    void this.onboarding.complete(CHECKLIST_GUIDE.id, CHECKLIST_GUIDE.version);
  }

  focusHandled(): void {
    this.focusPending.set(false);
  }

  hide(): void {
    this.celebrating.set(false);
  }

  async dismiss(): Promise<boolean> {
    this.celebrating.set(false);
    return this.onboarding.dismiss(CHECKLIST_GUIDE.id, CHECKLIST_GUIDE.version);
  }

  /// Shows the card again after it was dismissed or completed, and asks My work to bring it into view.
  async restore(): Promise<boolean> {
    this.celebrating.set(false);
    this.focusPending.set(true);
    const stored = this.onboarding.guides().get(CHECKLIST_GUIDE.id);
    const restored = !stored || (await this.onboarding.forget(CHECKLIST_GUIDE.id));
    void this.refresh();
    return restored;
  }
}
