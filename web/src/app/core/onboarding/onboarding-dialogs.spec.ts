import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user';
import { HelpMenuItem } from '../help/help-menu';
import { HelpMenuRegistry } from '../help/help-menu.registry';
import { ProjectDirectory, ProjectSummary } from '../projects/project-directory';
import { sessionKey } from './auto-dialogs.logic';
import { GettingStartedService } from './checklist/getting-started.service';
import { ActiveTour } from './engine/active-tour';
import { GuidedTours } from './guided-tours';
import { WELCOME_GUIDE } from './guides/welcome';
import { WhatsNewEntry } from './guides/whats-new';
import { GuideProgress } from './onboarding.models';
import { OnboardingStateService } from './onboarding-state.service';
import { WELCOME_DIALOG_ID, WHATS_NEW_DIALOG_ID } from './dialogs/onboarding-dialog-runner';
import { OnboardingDialogs, WHATS_NEW } from './onboarding-dialogs';

const NOVEMBER: WhatsNewEntry = {
  id: 'whats-new.2026-11',
  version: 1,
  date: '2026-11',
  title: 'November',
  items: [{ title: 'Docs', body: 'Pages and diagrams.' }],
};

interface OpenedDialog {
  id: string;
  closed: Subject<unknown>;
}

describe('OnboardingDialogs', () => {
  const user = signal<CurrentUser | null>(null);
  const loaded = signal(false);
  const guides = signal<ReadonlyMap<string, GuideProgress>>(new Map());
  const createdAt = signal<string | null>('2025-01-01T00:00:00Z');
  const restarts = signal(0);
  const running = signal<string | null>(null);
  const projects = signal<ProjectSummary[]>([]);
  let opened: OpenedDialog[];
  let openDialogs: unknown[];
  let allClosed: Subject<void>;
  let onboarding: { complete: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
  let tours: { start: ReturnType<typeof vi.fn> };
  let checklist: { restore: ReturnType<typeof vi.fn> };
  let router: { navigateByUrl: ReturnType<typeof vi.fn> };
  let helpItems: HelpMenuItem[];

  function store(id: string, version = 1): void {
    guides.update((map) =>
      new Map(map).set(id, { guideId: id, version, state: 'Completed', updatedAt: '' }),
    );
  }

  function project(key: string, myRole: ProjectSummary['myRole']): ProjectSummary {
    return { id: key, key, name: key, visibility: 'Private', myRole, updatedAt: '2026-10-01' };
  }

  function signIn(id = 'u1', globalRole: CurrentUser['globalRole'] = 'User'): void {
    user.set({ id, email: `${id}@x.test`, displayName: id, globalRole });
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  async function start(): Promise<OnboardingDialogs> {
    const service = TestBed.inject(OnboardingDialogs);
    service.watch();
    await settle();
    return service;
  }

  async function close(result?: unknown): Promise<void> {
    const dialog = opened.at(-1)!;
    openDialogs = [];
    dialog.closed.next(result);
    dialog.closed.complete();
    await settle();
  }

  beforeAll(async () => {
    await import('./dialogs/onboarding-dialog-runner');
  });

  beforeEach(() => {
    sessionStorage.clear();
    user.set(null);
    loaded.set(false);
    guides.set(new Map());
    createdAt.set('2025-01-01T00:00:00Z');
    restarts.set(0);
    running.set(null);
    projects.set([]);
    opened = [];
    openDialogs = [];
    allClosed = new Subject<void>();
    helpItems = [];
    onboarding = {
      complete: vi.fn((id: string, version: number) => {
        store(id, version);
        return Promise.resolve(true);
      }),
      dismiss: vi.fn((id: string, version: number) => {
        store(id, version);
        return Promise.resolve(true);
      }),
    };
    tours = { start: vi.fn().mockResolvedValue('completed') };
    checklist = { restore: vi.fn().mockResolvedValue(true) };
    router = { navigateByUrl: vi.fn().mockResolvedValue(true) };
    const dialog = {
      get openDialogs() {
        return openDialogs;
      },
      afterAllClosed: allClosed,
      getDialogById: (id: string) => opened.find((d) => d.id === id && !d.closed.closed),
      open: vi.fn((_component: unknown, config: { id: string }) => {
        const closed = new Subject<unknown>();
        opened.push({ id: config.id, closed });
        openDialogs = [{}];
        return { afterClosed: () => closed };
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialog, useValue: dialog },
        { provide: Router, useValue: router },
        { provide: WHATS_NEW, useValue: [NOVEMBER] },
        {
          provide: AuthService,
          useValue: { currentUser: user, isAdmin: computed(() => user()?.globalRole === 'Admin') },
        },
        {
          provide: OnboardingStateService,
          useValue: {
            ...onboarding,
            loaded,
            createdAt,
            restarts,
            isSeen: (id: string, version: number) => (guides().get(id)?.version ?? 0) >= version,
          },
        },
        { provide: ActiveTour, useValue: { id: running } },
        { provide: GuidedTours, useValue: tours },
        { provide: GettingStartedService, useValue: checklist },
        {
          provide: ProjectDirectory,
          useValue: {
            status: () => 'loaded',
            projects,
            reload: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: HelpMenuRegistry,
          useValue: { find: (id: string) => helpItems.find((i) => i.id === id) },
        },
      ],
    });
  });

  it('opens the welcome dialog once the state has loaded for a user without a welcome row', async () => {
    // Arrange
    signIn();
    await start();
    expect(opened).toHaveLength(0);

    // Act
    loaded.set(true);
    await settle();

    // Assert
    expect(opened.map((d) => d.id)).toEqual([WELCOME_DIALOG_ID]);
    expect(sessionStorage.getItem(sessionKey('u1'))).toBe('1');
  });

  it('opens at most one dialog per session: no What’s new after the welcome, nor on the next load', async () => {
    // Arrange
    signIn();
    loaded.set(true);
    await start();

    // Act
    await close();

    // Assert
    expect(onboarding.dismiss).toHaveBeenCalledWith(WELCOME_GUIDE.id, WELCOME_GUIDE.version);
    expect(opened).toHaveLength(1);

    // Act
    const reloaded = TestBed.runInInjectionContext(() => new OnboardingDialogs());
    reloaded.watch();
    await settle();

    // Assert
    expect(opened).toHaveLength(1);
  });

  it('opens the oldest due What’s new entry in a new session after the welcome', async () => {
    // Arrange
    store(WELCOME_GUIDE.id);
    signIn();
    loaded.set(true);

    // Act
    await start();

    // Assert
    expect(opened.map((d) => d.id)).toEqual([WHATS_NEW_DIALOG_ID]);

    // Act
    await close(true);

    // Assert
    expect(onboarding.complete).toHaveBeenCalledWith(NOVEMBER.id, NOVEMBER.version);
  });

  it('opens nothing for an entry whose month started before the account', async () => {
    // Arrange
    store(WELCOME_GUIDE.id);
    createdAt.set('2026-11-20T00:00:00Z');
    signIn();
    loaded.set(true);

    // Act
    const service = await start();

    // Assert
    expect(opened).toHaveLength(0);
    expect(service.hasNews()).toBe(false);
  });

  it('waits while a tour runs', async () => {
    // Arrange
    running.set('tour.backlog.list');
    signIn();
    loaded.set(true);
    await start();
    expect(opened).toHaveLength(0);

    // Act
    running.set(null);
    await settle();

    // Assert
    expect(opened.map((d) => d.id)).toEqual([WELCOME_DIALOG_ID]);
  });

  it('waits until another open dialog has closed', async () => {
    // Arrange
    openDialogs = [{}];
    signIn();
    loaded.set(true);
    await start();
    expect(opened).toHaveLength(0);

    // Act
    openDialogs = [];
    allClosed.next();
    await settle();

    // Assert
    expect(opened.map((d) => d.id)).toEqual([WELCOME_DIALOG_ID]);
  });

  it('Take the tour starts the backlog tour of the most recent writable project', async () => {
    // Arrange
    projects.set([project('VIEW', 'Viewer'), project('WEB', 'Member')]);
    signIn();
    loaded.set(true);
    await start();

    // Act
    await close('tour');

    // Assert
    expect(onboarding.complete).toHaveBeenCalledWith(WELCOME_GUIDE.id, WELCOME_GUIDE.version);
    expect(tours.start).toHaveBeenCalledWith('backlog.list', { projectKey: 'WEB' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('Take the tour runs the first-project walkthrough for a user who cannot write anywhere', async () => {
    // Arrange
    const run = vi.fn();
    helpItems = [{ id: 'help.tour.first-project', label: '', icon: '', order: 0, run }];
    projects.set([project('VIEW', 'Viewer')]);
    signIn();
    loaded.set(true);
    await start();

    // Act
    await close('tour');

    // Assert
    expect(run).toHaveBeenCalled();
    expect(tours.start).not.toHaveBeenCalled();
  });

  it('Take the tour shows the checklist when there is nothing to tour', async () => {
    // Arrange
    signIn();
    loaded.set(true);
    await start();

    // Act
    await close('tour');

    // Assert
    expect(checklist.restore).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/my-work');
  });

  it('Show me the checklist completes the welcome and focuses the card on My work', async () => {
    // Arrange
    signIn();
    loaded.set(true);
    await start();

    // Act
    await close('checklist');

    // Assert
    expect(onboarding.complete).toHaveBeenCalledWith(WELCOME_GUIDE.id, WELCOME_GUIDE.version);
    expect(checklist.restore).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/my-work');
  });

  it('Help → What’s new opens the entries whatever the session, and Esc dismisses the due ones', async () => {
    // Arrange
    store(WELCOME_GUIDE.id);
    sessionStorage.setItem(sessionKey('u1'), '1');
    signIn();
    loaded.set(true);
    const service = await start();
    expect(opened).toHaveLength(0);
    expect(service.hasNews()).toBe(true);

    // Act
    void service.showWhatsNew();
    await settle();
    await close();

    // Assert
    expect(opened.map((d) => d.id)).toEqual([WHATS_NEW_DIALOG_ID]);
    expect(onboarding.dismiss).toHaveBeenCalledWith(NOVEMBER.id, NOVEMBER.version);
    expect(service.hasNews()).toBe(false);
  });

  it('Restart all guides clears the session, so the welcome shows on the next load', async () => {
    // Arrange
    signIn();
    loaded.set(true);
    await start();
    await close();
    expect(sessionStorage.getItem(sessionKey('u1'))).toBe('1');

    // Act
    restarts.set(1);
    await settle();

    // Assert
    expect(sessionStorage.getItem(sessionKey('u1'))).toBeNull();
    expect(opened).toHaveLength(1);
  });
});
