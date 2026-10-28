import {
  afterNextRender,
  computed,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../notify/toast.service';
import { OnboardingApi } from './onboarding.api';
import {
  GUIDE_ID_MAX_LENGTH,
  GUIDE_ID_PATTERN,
  GuideProgress,
  GuideState,
  OnboardingChecklistItem,
} from './onboarding.models';

export type OnboardingStatus = 'idle' | 'loading' | 'ready' | 'error';

/// A write the server has not confirmed yet: the stored row it will leave, or null for a forget.
interface PendingWrite {
  value: GuideProgress | null;
}

/// The signed-in user's onboarding progress (D-130): which guide versions they completed or
/// dismissed, the getting-started checklist, whether they own a project and when their account
/// was created. Loaded after the first render (never at startup), only while signed in.
/// `complete`, `dismiss` and `resetAll` are optimistic and roll back with a toast on failure.
@Injectable({ providedIn: 'root' })
export class OnboardingStateService {
  private readonly api = inject(OnboardingApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly rendered = signal(false);
  private readonly state = signal<OnboardingStatus>('idle');
  private readonly progress = signal<ReadonlyMap<string, GuideProgress>>(new Map());
  private readonly checklistItems = signal<readonly OnboardingChecklistItem[]>([]);
  private readonly owner = signal(false);
  private readonly created = signal<string | null>(null);
  private readonly resets = signal(0);
  private readonly pending = new Map<string, PendingWrite>();
  private session = 0;
  private loadGeneration = 0;

  readonly status = this.state.asReadonly();
  /// True once the state is known; guides that open by themselves wait for it.
  readonly loaded = computed(() => this.state() === 'ready');
  readonly guides = this.progress.asReadonly();
  readonly checklist = this.checklistItems.asReadonly();
  readonly ownsProjects = this.owner.asReadonly();
  /// ISO time the account was created; What's new entries dated before it count as seen.
  readonly createdAt = this.created.asReadonly();
  /// Counts successful `resetAll` calls (Restart all guides) since the app loaded.
  readonly restarts = this.resets.asReadonly();

  constructor() {
    afterNextRender(() => this.rendered.set(true));
    effect(() => {
      const active = this.rendered() && this.auth.isAuthenticated();
      untracked(() => {
        if (active) void this.load();
        else this.reset();
      });
    });
  }

  /// Whether the user completed or dismissed this guide at `version` or later.
  isSeen(guideId: string, version: number): boolean {
    const stored = this.progress().get(guideId);
    return stored !== undefined && stored.version >= version;
  }

  complete(guideId: string, version: number): Promise<boolean> {
    return this.record(guideId, version, 'Completed');
  }

  dismiss(guideId: string, version: number): Promise<boolean> {
    return this.record(guideId, version, 'Dismissed');
  }

  /// Forgets one completed or dismissed guide, so it shows again (D-133).
  async forget(guideId: string): Promise<boolean> {
    assertGuideId(guideId);
    if (!this.auth.isAuthenticated()) return false;

    const session = this.session;
    const previous = this.progress().get(guideId) ?? null;
    const write: PendingWrite = { value: null };
    this.pending.set(guideId, write);
    this.set(guideId, null);
    try {
      await firstValueFrom(this.api.forgetGuide(guideId));
      this.settle(session, guideId, write);
      return true;
    } catch (error) {
      if (this.settle(session, guideId, write)) this.set(guideId, previous);
      this.toast.error(error);
      return false;
    }
  }

  /// Forgets every completed or dismissed guide, so all of them can show again.
  async resetAll(): Promise<boolean> {
    if (!this.auth.isAuthenticated()) return false;
    const session = this.session;
    const previous = this.progress();
    this.loadGeneration++;
    this.pending.clear();
    this.progress.set(new Map());
    try {
      await firstValueFrom(this.api.resetGuides());
      this.resets.update((n) => n + 1);
      return true;
    } catch (error) {
      if (session === this.session && this.progress().size === 0) this.progress.set(previous);
      this.toast.error(error);
      return false;
    } finally {
      if (session === this.session && this.state() !== 'ready') void this.load();
    }
  }

  /// Fetches the state again, for example after an action that may tick off a checklist item.
  async load(): Promise<void> {
    if (!this.auth.isAuthenticated()) return;
    const session = this.session;
    const generation = ++this.loadGeneration;
    if (this.state() !== 'ready') this.state.set('loading');
    try {
      const onboarding = await firstValueFrom(this.api.get());
      if (session !== this.session || generation !== this.loadGeneration) return;
      const guides = new Map(onboarding.guides.map((g) => [g.guideId, g]));
      for (const [guideId, local] of this.pending)
        if (local.value) guides.set(guideId, local.value);
        else guides.delete(guideId);
      this.progress.set(guides);
      this.checklistItems.set(onboarding.checklist);
      this.owner.set(onboarding.ownsProjects);
      this.created.set(onboarding.createdAt);
      this.state.set('ready');
    } catch {
      if (
        session === this.session &&
        generation === this.loadGeneration &&
        this.state() !== 'ready'
      )
        this.state.set('error');
    }
  }

  private async record(guideId: string, version: number, state: GuideState): Promise<boolean> {
    assertGuideId(guideId);
    if (!this.auth.isAuthenticated()) return false;

    const session = this.session;
    const previous = this.progress().get(guideId) ?? null;
    const optimistic: GuideProgress = {
      guideId,
      version,
      state,
      updatedAt: new Date().toISOString(),
    };
    const write: PendingWrite = { value: optimistic };
    this.pending.set(guideId, write);
    this.set(guideId, optimistic);
    try {
      const saved = await firstValueFrom(this.api.setGuide(guideId, version, state));
      if (this.settle(session, guideId, write)) this.set(guideId, saved);
      return true;
    } catch (error) {
      if (this.settle(session, guideId, write)) this.set(guideId, previous);
      this.toast.error(error);
      return false;
    }
  }

  /// Ends an optimistic write; false when a newer write, a reset or a sign-out superseded it.
  private settle(session: number, guideId: string, write: PendingWrite): boolean {
    if (session !== this.session || this.pending.get(guideId) !== write) return false;
    this.pending.delete(guideId);
    return true;
  }

  private set(guideId: string, value: GuideProgress | null): void {
    this.progress.update((current) => {
      const next = new Map(current);
      if (value) next.set(guideId, value);
      else next.delete(guideId);
      return next;
    });
  }

  private reset(): void {
    this.session++;
    this.loadGeneration++;
    this.pending.clear();
    this.state.set('idle');
    this.progress.set(new Map());
    this.checklistItems.set([]);
    this.owner.set(false);
    this.created.set(null);
  }
}

function assertGuideId(guideId: string): void {
  if (guideId.length > GUIDE_ID_MAX_LENGTH || !GUIDE_ID_PATTERN.test(guideId))
    throw new Error(`Invalid guide id '${guideId}'.`);
}
