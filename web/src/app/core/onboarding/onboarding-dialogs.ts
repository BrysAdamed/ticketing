import { DOCUMENT } from '@angular/common';
import {
  computed,
  effect,
  EnvironmentProviders,
  inject,
  Injectable,
  InjectionToken,
  Injector,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  untracked,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { take } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HELP_MENU_ORDER } from '../help/help-menu';
import { provideHelpMenuItem } from '../help/help-menu.registry';
import {
  AutoDialog,
  AutoDialogSession,
  dueWhatsNew,
  IsSeen,
  nextAutoDialog,
  whatsNewNewestFirst,
} from './auto-dialogs.logic';
import { ActiveTour } from './engine/active-tour';
import { WHATS_NEW_ENTRIES, WhatsNewEntry } from './guides/whats-new';
import { OnboardingStateService } from './onboarding-state.service';
import type { OnboardingDialogRunner } from './dialogs/onboarding-dialog-runner';

export const WHATS_NEW_HELP_ID = 'help.whats-new';

/// The What's new entries the app offers; tests replace it.
export const WHATS_NEW = new InjectionToken<readonly WhatsNewEntry[]>('WHATS_NEW', {
  factory: () => WHATS_NEW_ENTRIES,
});

/// The dialogs that open by themselves (spec 14.1, 14.2): the welcome dialog while the user has no
/// `welcome` row, otherwise the oldest due What's new entry. At most one per browser session and
/// user, decided once per app load after the onboarding state has loaded, never while a tour runs
/// or another dialog is open. Only this decision is eager; the dialogs and their actions
/// (`OnboardingDialogRunner`) are a lazy chunk.
@Injectable({ providedIn: 'root' })
export class OnboardingDialogs {
  private readonly injector = inject(Injector);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);
  private readonly onboarding = inject(OnboardingStateService);
  private readonly activeTour = inject(ActiveTour).id;
  private readonly session = new AutoDialogSession(sessionStorageOf(inject(DOCUMENT)));
  private readonly dialogsClosed = signal(0);
  private evaluatedFor: string | null = null;
  private waitingForDialogs = false;
  private watching = false;

  readonly entries = inject(WHATS_NEW);
  private readonly isSeen: IsSeen = (id, version) => this.onboarding.isSeen(id, version);

  /// The user has What's new entries they have not seen yet (the Help menu marks the item).
  readonly hasNews = computed(
    () =>
      this.onboarding.loaded() &&
      dueWhatsNew(this.entries, this.isSeen, this.onboarding.createdAt()).length > 0,
  );

  /// Starts deciding on the auto-shown dialog; `provideOnboardingDialogs` calls it once.
  watch(): void {
    if (this.watching) return;
    this.watching = true;
    effect(
      () => {
        this.dialogsClosed();
        const user = this.auth.currentUser();
        if (!user) {
          this.evaluatedFor = null;
          return;
        }
        if (!this.onboarding.loaded() || this.activeTour() !== null) return;
        untracked(() => this.evaluate(user.id));
      },
      { injector: this.injector },
    );
    effect(
      () => {
        if (this.onboarding.restarts() === 0) return;
        const user = untracked(this.auth.currentUser);
        if (user) this.session.forget(user.id);
      },
      { injector: this.injector },
    );
  }

  /// Help → What's new: every entry, newest first, whatever the session.
  async showWhatsNew(): Promise<void> {
    await (await this.runner()).openWhatsNew(whatsNewNewestFirst(this.entries));
  }

  private evaluate(userId: string): void {
    if (this.evaluatedFor === userId) return;
    if (this.dialog.openDialogs.length > 0) {
      if (this.waitingForDialogs) return;
      this.waitingForDialogs = true;
      this.dialog.afterAllClosed.pipe(take(1)).subscribe(() => {
        this.waitingForDialogs = false;
        this.dialogsClosed.update((n) => n + 1);
      });
      return;
    }
    this.evaluatedFor = userId;
    if (this.session.wasShown(userId)) return;
    const next = nextAutoDialog(this.entries, this.isSeen, this.onboarding.createdAt());
    if (!next) return;
    this.session.markShown(userId);
    void this.open(next);
  }

  private async open(next: AutoDialog): Promise<void> {
    const runner = await this.runner();
    if (this.activeTour() !== null) return;
    await (next.kind === 'welcome' ? runner.openWelcome() : runner.openWhatsNew([next.entry]));
  }

  private async runner(): Promise<OnboardingDialogRunner> {
    const { OnboardingDialogRunner } = await import('./dialogs/onboarding-dialog-runner');
    return this.injector.get(OnboardingDialogRunner);
  }
}

/// Opens the welcome dialog or a due What's new entry by itself, and registers Help → What's new.
export function provideOnboardingDialogs(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => inject(OnboardingDialogs).watch()),
    provideHelpMenuItem(() => {
      const dialogs = inject(OnboardingDialogs);
      return {
        id: WHATS_NEW_HELP_ID,
        label: 'What’s new',
        icon: 'tablerSparkles',
        order: HELP_MENU_ORDER.whatsNew,
        keywords: ['whats new', 'release', 'changes', 'highlights', 'news'],
        visible: () => dialogs.entries.length > 0,
        hint: () => (dialogs.hasNews() ? 'New' : null),
        run: () => void dialogs.showWhatsNew(),
      };
    }),
  ]);
}

function sessionStorageOf(document: Document): Storage | null {
  try {
    return document.defaultView?.sessionStorage ?? null;
  } catch {
    return null;
  }
}
