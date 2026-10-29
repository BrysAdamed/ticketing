import {
  createEnvironmentInjector,
  EnvironmentInjector,
  provideZonelessChangeDetection,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyAchievement } from '@core/achievements/achievement.models';
import { HelpMenuRegistry } from '@core/help/help-menu.registry';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { CONNECT_AGENT_HELP_ID } from '@core/onboarding/agent/connect-agent';
import { provideConnectAgentHelp } from '@core/onboarding/agent/connect-agent.help';
import { LearnActions } from '@core/onboarding/learn-actions';
import { OnboardingStateService } from '@core/onboarding/onboarding-state.service';
import { TOUR_CATALOGUE } from '@core/onboarding/tours/tour-catalogue';
import {
  ACHIEVEMENT_LEARN_ACTIONS,
  AchievementLearnTarget,
  canStartLearn,
  learnActionFor,
  startLearn,
} from './achievement-learn';

/// The catalogue of spec 15.2 (`AchievementCatalog.cs`).
const CATALOGUE = [
  'reporter',
  'closer',
  'ready-for-review',
  'bug-hunter',
  'exterminator',
  'conversationalist',
  'connector',
  'show-me',
  'triage',
  'test-author',
  'regression-runner',
  'found-it',
  'full-sweep',
  'board-builder',
  'spring-cleaning',
  'delegator',
  'machine-whisperer',
  'epic-finisher',
  'shout-out',
];
const SECRETS = ['second-thoughts', 'unblocker', 'grand-tour'];

/// The Help registry with the app's always-on Help providers (`app.config.ts`) registered.
function registeredHelp(): HelpMenuRegistry {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: ConfirmService, useValue: {} },
      { provide: ToastService, useValue: {} },
      { provide: OnboardingStateService, useValue: {} },
    ],
  });
  createEnvironmentInjector([provideConnectAgentHelp()], TestBed.inject(EnvironmentInjector));
  return TestBed.inject(HelpMenuRegistry);
}

function locked(id: string, overrides: Partial<MyAchievement> = {}): MyAchievement {
  return {
    id,
    name: id,
    description: `${id} things.`,
    howToEarn: `Do ${id} things.`,
    icon: 'file-plus',
    secret: false,
    masked: false,
    tier: 0,
    shared: false,
    tiers: [{ tier: 1, threshold: 1, unlockedAt: null, seenAt: null }],
    progress: { count: 0, nextTier: 1, nextThreshold: 1 },
    ...overrides,
  };
}

function fakeLearn(startable: boolean): LearnActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    canStartTour: vi.fn(() => startable),
    canStartWalkthrough: vi.fn(() => startable),
    canRunHelpItem: vi.fn(() => startable),
    startTour: vi.fn().mockResolvedValue(undefined),
    startWalkthrough: vi.fn(),
    runHelpItem: vi.fn(),
  } as unknown as LearnActions & Record<string, ReturnType<typeof vi.fn>>;
}

describe('achievement learn actions', () => {
  it('maps only catalogue entries that are not secret', () => {
    // Arrange
    const ids = [...ACHIEVEMENT_LEARN_ACTIONS.keys()];

    // Act / Assert
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(CATALOGUE).toContain(id);
      expect(SECRETS).not.toContain(id);
    }
  });

  it.each([...ACHIEVEMENT_LEARN_ACTIONS.entries()])(
    '%s starts something real that can start from the Achievements tab',
    (_id, action) => {
      // Arrange
      const { target } = action;

      // Act / Assert
      expect(action.note.trim()).not.toBe('');
      switch (target.kind) {
        case 'tour': {
          const entry = TOUR_CATALOGUE.find((e) => e.viewId === target.viewId);
          expect(entry).toBeDefined();
          expect(entry?.path).toBeTruthy();
          expect(entry?.requires).toBeUndefined();
          break;
        }
        case 'help':
          expect(registeredHelp().find(target.itemId)).toBeDefined();
          break;
        case 'walkthrough':
          break;
      }
    },
  );

  it('offers the mapped action of a locked or in-progress entry', () => {
    // Arrange
    const inProgress = locked('reporter', {
      tiers: [1, 10].map((threshold, i) => ({
        tier: i + 1,
        threshold,
        unlockedAt: null,
        seenAt: null,
      })),
      progress: { count: 0, nextTier: 1, nextThreshold: 1 },
    });

    // Act / Assert
    expect(learnActionFor(locked('machine-whisperer'))?.target).toEqual({
      kind: 'help',
      itemId: CONNECT_AGENT_HELP_ID,
    });
    expect(learnActionFor(inProgress)?.target).toEqual({ kind: 'tour', viewId: 'backlog.list' });
  });

  it('offers nothing for earned, unmapped, secret or masked entries', () => {
    // Arrange
    const masked = locked('x', {
      id: null,
      name: null,
      description: null,
      howToEarn: null,
      icon: null,
      secret: true,
      masked: true,
      tiers: [],
      progress: null,
    });

    // Act / Assert
    expect(learnActionFor(locked('reporter', { tier: 1 }))).toBeNull();
    expect(learnActionFor(locked('connector'))).toBeNull();
    expect(learnActionFor(masked)).toBeNull();
    for (const id of SECRETS)
      expect(learnActionFor(locked(id, { secret: true, howToEarn: null }))).toBeNull();
    expect(learnActionFor(locked('reporter', { secret: true }))).toBeNull();
    expect(learnActionFor(locked('constructor'))).toBeNull();
  });

  it.each<[AchievementLearnTarget, string, string]>([
    [{ kind: 'tour', viewId: 'backlog.list' }, 'canStartTour', 'backlog.list'],
    [{ kind: 'walkthrough', skipOptional: true }, 'canStartWalkthrough', ''],
    [{ kind: 'help', itemId: CONNECT_AGENT_HELP_ID }, 'canRunHelpItem', CONNECT_AGENT_HELP_ID],
  ])('is hidden while %o cannot start', (target, check, arg) => {
    // Arrange
    const closed = fakeLearn(false);
    const open = fakeLearn(true);

    // Act / Assert
    expect(canStartLearn(closed, target)).toBe(false);
    expect(canStartLearn(open, target)).toBe(true);
    if (arg) expect(open[check]).toHaveBeenCalledWith(arg);
  });

  it('starts the target through LearnActions', () => {
    // Arrange
    const learn = fakeLearn(true);

    // Act
    startLearn(learn, { kind: 'tour', viewId: 'testcases.list' });
    startLearn(learn, { kind: 'walkthrough', skipOptional: true });
    startLearn(learn, { kind: 'help', itemId: CONNECT_AGENT_HELP_ID });

    // Assert
    expect(learn['startTour']).toHaveBeenCalledWith('testcases.list');
    expect(learn['startWalkthrough']).toHaveBeenCalledWith({ skipOptional: true });
    expect(learn['runHelpItem']).toHaveBeenCalledWith(CONNECT_AGENT_HELP_ID);
  });
});
