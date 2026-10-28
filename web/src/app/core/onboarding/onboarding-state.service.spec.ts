import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ToastService } from '../notify/toast.service';
import { OnboardingApi } from './onboarding.api';
import { GuideProgress, GuideState, Onboarding } from './onboarding.models';
import { OnboardingStateService } from './onboarding-state.service';

const CREATED_AT = '2026-10-01T08:00:00Z';

function guide(guideId: string, version: number, state: GuideState = 'Completed'): GuideProgress {
  return { guideId, version, state, updatedAt: '2026-10-20T10:00:00Z' };
}

function onboarding(guides: GuideProgress[] = [], ownsProjects = false): Onboarding {
  return { checklist: [], guides, ownsProjects, createdAt: CREATED_AT };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('OnboardingStateService', () => {
  let api: {
    get: ReturnType<typeof vi.fn>;
    setGuide: ReturnType<typeof vi.fn>;
    resetGuides: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn> };
  const signedIn = signal(true);

  async function create(): Promise<OnboardingStateService> {
    const store = TestBed.inject(OnboardingStateService);
    TestBed.tick();
    await flush();
    return store;
  }

  beforeEach(() => {
    signedIn.set(true);
    api = {
      get: vi.fn().mockReturnValue(of(onboarding())),
      setGuide: vi.fn((guideId: string, version: number, state: GuideState) =>
        of(guide(guideId, version, state)),
      ),
      resetGuides: vi.fn().mockReturnValue(of(undefined)),
    };
    toast = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: OnboardingApi, useValue: api },
        { provide: AuthService, useValue: { isAuthenticated: computed(() => signedIn()) } },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  describe('loading', () => {
    it('loads after the first render, not when the service is created', async () => {
      // Arrange
      api.get.mockReturnValue(of(onboarding([guide('welcome', 1)], true)));

      // Act
      const store = TestBed.inject(OnboardingStateService);

      // Assert
      expect(api.get).not.toHaveBeenCalled();
      expect(store.status()).toBe('idle');

      // Act
      TestBed.tick();
      await flush();

      // Assert
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(store.loaded()).toBe(true);
      expect(store.ownsProjects()).toBe(true);
      expect(store.createdAt()).toBe(CREATED_AT);
      expect(store.isSeen('welcome', 1)).toBe(true);
    });

    it('does nothing for a signed-out visitor and forgets everything at sign-out', async () => {
      // Arrange
      signedIn.set(false);
      const store = await create();

      // Assert
      expect(api.get).not.toHaveBeenCalled();
      expect(await store.complete('welcome', 1)).toBe(false);
      expect(api.setGuide).not.toHaveBeenCalled();

      // Act
      api.get.mockReturnValue(of(onboarding([guide('welcome', 1)])));
      signedIn.set(true);
      TestBed.tick();
      await flush();

      // Assert
      expect(store.isSeen('welcome', 1)).toBe(true);

      // Act
      signedIn.set(false);
      TestBed.tick();

      // Assert
      expect(store.status()).toBe('idle');
      expect(store.isSeen('welcome', 1)).toBe(false);
      expect(store.createdAt()).toBeNull();
    });

    it('reports an error when the first load fails', async () => {
      // Arrange
      api.get.mockReturnValue(throwError(() => new Error('offline')));

      // Act
      const store = await create();

      // Assert
      expect(store.status()).toBe('error');
      expect(store.loaded()).toBe(false);
    });
  });

  describe('isSeen', () => {
    it('is true only when the stored version is at least the current one', async () => {
      // Arrange
      api.get.mockReturnValue(of(onboarding([guide('tour.backlog.list', 2, 'Dismissed')])));
      const store = await create();

      // Assert
      expect(store.isSeen('tour.backlog.list', 1)).toBe(true);
      expect(store.isSeen('tour.backlog.list', 2)).toBe(true);
      expect(store.isSeen('tour.backlog.list', 3)).toBe(false);
      expect(store.isSeen('welcome', 1)).toBe(false);
    });
  });

  describe('complete and dismiss', () => {
    it('show the guide as seen at once and keep the stored row', async () => {
      // Arrange
      const store = await create();
      const response = new Subject<GuideProgress>();
      api.setGuide.mockReturnValue(response);

      // Act
      const done = store.dismiss('hint.free-transitions', 1);

      // Assert
      expect(store.isSeen('hint.free-transitions', 1)).toBe(true);
      expect(api.setGuide).toHaveBeenCalledWith('hint.free-transitions', 1, 'Dismissed');

      // Act
      response.next(guide('hint.free-transitions', 1, 'Dismissed'));
      response.complete();

      // Assert
      expect(await done).toBe(true);
      expect(store.guides().get('hint.free-transitions')?.updatedAt).toBe('2026-10-20T10:00:00Z');
    });

    it('roll back to the previous row and toast when the server refuses', async () => {
      // Arrange
      api.get.mockReturnValue(of(onboarding([guide('tour.backlog.list', 1)])));
      const store = await create();
      const error = new Error('limit');
      api.setGuide.mockReturnValue(throwError(() => error));

      // Act
      const result = await store.complete('tour.backlog.list', 2);

      // Assert
      expect(result).toBe(false);
      expect(store.guides().get('tour.backlog.list')?.version).toBe(1);
      expect(toast.error).toHaveBeenCalledWith(error);
    });

    it('remove an optimistic row that had nothing before it when the write fails', async () => {
      // Arrange
      const store = await create();
      api.setGuide.mockReturnValue(throwError(() => new Error('down')));

      // Act
      await store.complete('welcome', 1);

      // Assert
      expect(store.guides().has('welcome')).toBe(false);
    });

    it('keep a pending write when a reload answers before it', async () => {
      // Arrange
      const store = await create();
      const response = new Subject<GuideProgress>();
      api.setGuide.mockReturnValue(response);
      void store.complete('welcome', 1);

      // Act
      await store.load();

      // Assert
      expect(store.isSeen('welcome', 1)).toBe(true);
    });

    it('reject ids that are not code-authored guide ids', async () => {
      // Arrange
      const store = await create();

      // Act and assert
      await expect(store.complete('Tour Backlog', 1)).rejects.toThrow(/Invalid guide id/);
      await expect(store.complete('a'.repeat(101), 1)).rejects.toThrow(/Invalid guide id/);
      expect(api.setGuide).not.toHaveBeenCalled();
    });
  });

  describe('resetAll', () => {
    it('forgets every guide at once', async () => {
      // Arrange
      api.get.mockReturnValue(of(onboarding([guide('welcome', 1), guide('tour.backlog.list', 1)])));
      const store = await create();

      // Act
      const result = await store.resetAll();

      // Assert
      expect(result).toBe(true);
      expect(api.resetGuides).toHaveBeenCalledTimes(1);
      expect(store.guides().size).toBe(0);
    });

    it('restores the guides and toasts when the server refuses', async () => {
      // Arrange
      api.get.mockReturnValue(of(onboarding([guide('welcome', 1)])));
      const store = await create();
      const error = new Error('down');
      api.resetGuides.mockReturnValue(throwError(() => error));

      // Act
      const result = await store.resetAll();

      // Assert
      expect(result).toBe(false);
      expect(store.isSeen('welcome', 1)).toBe(true);
      expect(toast.error).toHaveBeenCalledWith(error);
    });
  });
});
