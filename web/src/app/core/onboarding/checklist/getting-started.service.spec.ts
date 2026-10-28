import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GuideProgress, GuideState, OnboardingChecklistItem } from '../onboarding.models';
import { OnboardingStateService, OnboardingStatus } from '../onboarding-state.service';
import { CHECKLIST_GUIDE } from './checklist.model';
import { GettingStartedService } from './getting-started.service';

function item(id: string, done = false, optional = false): OnboardingChecklistItem {
  return { id, done, optional };
}

describe('GettingStartedService', () => {
  const status = signal<OnboardingStatus>('ready');
  const checklist = signal<OnboardingChecklistItem[]>([]);
  const guides = signal<ReadonlyMap<string, GuideProgress>>(new Map());
  let onboarding: {
    complete: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  function store(guideState: GuideState | null, version = CHECKLIST_GUIDE.version): void {
    guides.set(
      guideState
        ? new Map([
            [
              CHECKLIST_GUIDE.id,
              { guideId: CHECKLIST_GUIDE.id, version, state: guideState, updatedAt: '' },
            ],
          ])
        : new Map(),
    );
  }

  function create(): GettingStartedService {
    return TestBed.inject(GettingStartedService);
  }

  beforeEach(() => {
    status.set('ready');
    checklist.set([item('create-ticket'), item('follow-ticket'), item('agent-token', false, true)]);
    store(null);
    onboarding = {
      complete: vi.fn((id: string, version: number) => {
        store('Completed', version);
        return Promise.resolve(true);
      }),
      dismiss: vi.fn((id: string, version: number) => {
        store('Dismissed', version);
        return Promise.resolve(true);
      }),
      forget: vi.fn(() => {
        store(null);
        return Promise.resolve(true);
      }),
      load: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: OnboardingStateService,
          useValue: {
            ...onboarding,
            status,
            loaded: computed(() => status() === 'ready'),
            checklist,
            guides,
            isSeen: (id: string, version: number) => (guides().get(id)?.version ?? 0) >= version,
          },
        },
      ],
    });
  });

  it('shows a skeleton until the state is known, then the card', () => {
    // Arrange
    status.set('loading');
    const service = create();

    // Assert
    expect(service.loading()).toBe(true);
    expect(service.visible()).toBe(false);

    // Act
    status.set('ready');

    // Assert
    expect(service.loading()).toBe(false);
    expect(service.visible()).toBe(true);
    expect(service.progress()).toEqual({ done: 0, total: 2, complete: false });
  });

  it('hides the card once dismissed, and a higher guide version shows it again', async () => {
    // Arrange
    const service = create();

    // Act
    await service.dismiss();

    // Assert
    expect(onboarding.dismiss).toHaveBeenCalledWith('checklist', CHECKLIST_GUIDE.version);
    expect(service.visible()).toBe(false);

    // Act
    store('Dismissed', CHECKLIST_GUIDE.version - 1);

    // Assert
    expect(service.visible()).toBe(true);
  });

  it('keeps showing the completed state for the visit after storing Completed, until hidden', () => {
    // Arrange
    checklist.set([
      item('create-ticket', true),
      item('follow-ticket', true),
      item('agent-token', false, true),
    ]);
    const service = create();

    // Act
    service.acknowledgeCompletion();
    service.acknowledgeCompletion();

    // Assert
    expect(onboarding.complete).toHaveBeenCalledTimes(1);
    expect(onboarding.complete).toHaveBeenCalledWith('checklist', CHECKLIST_GUIDE.version);
    expect(service.visible()).toBe(true);
    expect(service.completed()).toBe(true);

    // Act
    service.hide();

    // Assert
    expect(service.visible()).toBe(false);
  });

  it('does not store completion while a required item is open', () => {
    // Arrange
    checklist.set([
      item('create-ticket', true),
      item('follow-ticket'),
      item('agent-token', true, true),
    ]);
    const service = create();

    // Act
    service.acknowledgeCompletion();

    // Assert
    expect(onboarding.complete).not.toHaveBeenCalled();
    expect(service.completed()).toBe(false);
  });

  it('restores a dismissed card, asks My work to focus it and refreshes the items', async () => {
    // Arrange
    store('Dismissed');
    const service = create();
    const before = service.focusRequested();

    // Act
    const restored = await service.restore();

    // Assert
    expect(restored).toBe(true);
    expect(onboarding.forget).toHaveBeenCalledWith('checklist');
    expect(onboarding.load).toHaveBeenCalled();
    expect(service.visible()).toBe(true);
    expect(service.focusRequested()).toBe(before + 1);
  });

  it('does not call the server to restore a card that was never hidden', async () => {
    // Arrange
    const service = create();

    // Act
    await service.restore();

    // Assert
    expect(onboarding.forget).not.toHaveBeenCalled();
    expect(service.visible()).toBe(true);
  });
});
