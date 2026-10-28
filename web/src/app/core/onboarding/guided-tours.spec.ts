import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  inject,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { CommandRegistry } from '../commands/command-registry';
import { TOUR_OF_PAGE_ID } from '../help/help-menu';
import { HelpMenuRegistry } from '../help/help-menu.registry';
import { ConfirmService } from '../notify/confirm.service';
import { ToastService } from '../notify/toast.service';
import { OpenProject, OpenProjectState } from '../projects/open-project';
import { ProjectDirectory, ProjectSummary } from '../projects/project-directory';
import { TourAnchorRegistry } from './engine/tour-anchor.registry';
import { TourLauncher, TourResult } from './engine/tour-launcher';
import { TourAccess, TourDefinition } from './engine/tour.model';
import { GuidedTours } from './guided-tours';
import { provideGuidedTours, TOURS } from './tour-availability';
import { OnboardingApi } from './onboarding.api';
import { GuideState } from './onboarding.models';
import { TourCatalogueEntry } from './tours/tour-catalogue';
import { ViewTourAccess } from './view-tour-access';

const TOUR: TourDefinition = {
  id: 'tour.test.view',
  version: 2,
  viewId: 'test.view',
  title: 'Test',
  steps: [
    { id: 'all', anchor: 'test.all', title: 'All', body: 'For everyone' },
    { id: 'write', anchor: 'test.write', requires: 'write', title: 'Write', body: 'Writers' },
  ],
};

const ENTRY: TourCatalogueEntry = {
  viewId: 'test.view',
  title: 'Test',
  path: '/projects/:projectKey/test',
  load: () => Promise.resolve(TOUR),
};

const ADMIN_TOUR: TourDefinition = {
  id: 'tour.admin.view',
  version: 1,
  viewId: 'admin.view',
  title: 'Admin',
  steps: [{ id: 'a', anchor: 'admin.a', requires: 'admin', title: 'A', body: 'Admins' }],
};

const ADMIN_ENTRY: TourCatalogueEntry = {
  viewId: 'admin.view',
  title: 'Admin',
  path: '/admin-page',
  requires: 'admin',
  load: () => Promise.resolve(ADMIN_TOUR),
};

const OWNER_ENTRY: TourCatalogueEntry = {
  viewId: 'owner.view',
  title: 'Owner',
  requires: 'owner',
  load: () => Promise.resolve({ ...TOUR, id: 'tour.owner.view', viewId: 'owner.view' }),
};

const MEMBER: OpenProject = { key: 'WEB', name: 'Web', archived: false, role: 'Member' };

@Component({ selector: 'tk-blank', template: 'blank' })
class BlankComponent {}

@Component({ selector: 'tk-project-page', template: 'project' })
class ProjectPageComponent {
  constructor() {
    inject(OpenProjectState).project.set(MEMBER);
    inject(TourAnchorRegistry).register('test.all', document.body);
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('GuidedTours', () => {
  let launcher: { start: ReturnType<typeof vi.fn>; running: ReturnType<typeof signal> };
  let api: { get: ReturnType<typeof vi.fn>; setGuide: ReturnType<typeof vi.fn> };
  let projects: ReturnType<typeof signal<readonly ProjectSummary[]>>;
  let tours: GuidedTours;
  let isAdmin: ReturnType<typeof signal<boolean>>;
  let router: Router;

  beforeEach(async () => {
    launcher = {
      start: vi.fn().mockResolvedValue('completed' satisfies TourResult),
      running: signal(null),
    };
    api = {
      get: vi
        .fn()
        .mockReturnValue(
          of({ checklist: [], guides: [], ownsProjects: false, createdAt: '2026-01-01T00:00:00Z' }),
        ),
      setGuide: vi.fn((guideId: string, version: number, state: GuideState) =>
        of({ guideId, version, state, updatedAt: '2026-10-28T10:00:00Z' }),
      ),
    };
    projects = signal<readonly ProjectSummary[]>([]);
    isAdmin = signal(false);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          { path: 'other', component: BlankComponent, data: { viewId: 'other.view' } },
          { path: 'here', component: BlankComponent, data: { viewId: 'test.view' } },
          { path: 'admin-page', component: BlankComponent, data: { viewId: 'admin.view' } },
          { path: 'owner-page', component: BlankComponent, data: { viewId: 'owner.view' } },
          {
            path: 'projects/:projectKey/test',
            component: ProjectPageComponent,
            data: { viewId: 'test.view' },
          },
        ]),
        { provide: TOURS, useValue: [ENTRY, ADMIN_ENTRY, OWNER_ENTRY] },
        { provide: TourLauncher, useValue: launcher },
        { provide: OnboardingApi, useValue: api },
        { provide: ProjectDirectory, useValue: { projects } },
        {
          provide: AuthService,
          useValue: { isAuthenticated: signal(true), isAdmin },
        },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: ConfirmService, useValue: { confirm: vi.fn() } },
      ],
    });
    createEnvironmentInjector([provideGuidedTours()], TestBed.inject(EnvironmentInjector));
    tours = TestBed.inject(GuidedTours);
    router = TestBed.inject(Router);
    await RouterTestingHarness.create('/other');
  });

  const help = () => TestBed.inject(HelpMenuRegistry);
  const tourOfPage = () =>
    help()
      .items()
      .find((i) => i.id === TOUR_OF_PAGE_ID)!;
  const command = () =>
    TestBed.inject(CommandRegistry)
      .commands()
      .find((c) => c.id === 'help.tour.test.view');

  describe('Help menu and palette', () => {
    it('disables Tour of this page on a view without a tour and enables it on one with a tour', async () => {
      // Assert: no tour here
      expect(tourOfPage().disabled!()).toBe(true);
      expect(tourOfPage().hint!()).toBe('No tour here');

      // Act
      await router.navigateByUrl('/here');

      // Assert
      expect(tourOfPage().disabled!()).toBe(false);
      expect(tourOfPage().hint!()).toBeNull();
    });

    it('offers one palette command per tour that is not a menu item', () => {
      // Assert
      expect(command()?.label).toBe('Test tour');
      expect(
        help()
          .items()
          .some((i) => i.id === 'help.tour.test.view'),
      ).toBe(false);
    });

    it('makes the tour command available on its view, or elsewhere when a project can be opened', async () => {
      // Assert: no project to open
      expect(command()!.available!()).toBe(false);

      // Act
      projects.set([{ id: '1', key: 'WEB', name: 'Web', visibility: 'Public', myRole: 'Member' }]);

      // Assert
      expect(command()!.available!()).toBe(true);

      // Act
      projects.set([]);
      await router.navigateByUrl('/here');

      // Assert
      expect(command()!.available!()).toBe(true);
    });
  });

  describe('tours for one audience', () => {
    const commandOf = (viewId: string) =>
      TestBed.inject(CommandRegistry)
        .commands()
        .find((c) => c.id === `help.tour.${viewId}`);

    it('offers an Admin tour with a project-less path to Admins only, from anywhere', () => {
      // Assert: not an Admin
      expect(commandOf('admin.view')!.available!()).toBe(false);

      // Act
      isAdmin.set(true);

      // Assert: no project needed
      expect(commandOf('admin.view')!.available!()).toBe(true);
    });

    it('starts an Admin tour away from its view without picking a project', async () => {
      // Arrange
      isAdmin.set(true);

      // Act
      const result = await tours.start('admin.view');

      // Assert
      expect(result).toBe('completed');
      expect(router.url).toBe('/admin-page');
      expect(launcher.start).toHaveBeenCalledWith(ADMIN_TOUR, {
        access: { canWrite: false, isOwner: false, isAdmin: true },
        params: {},
        returnFocusTo: undefined,
      });
    });

    it('enables Tour of this page on an Owner tour for Owners only', async () => {
      // Arrange
      await router.navigateByUrl('/owner-page');
      const open = TestBed.inject(OpenProjectState).project;

      // Act
      open.set(MEMBER);

      // Assert
      expect(tourOfPage().disabled!()).toBe(true);
      expect(commandOf('owner.view')!.available!()).toBe(false);

      // Act
      open.set({ ...MEMBER, role: 'Owner' });

      // Assert
      expect(tourOfPage().disabled!()).toBe(false);
      expect(commandOf('owner.view')!.available!()).toBe(true);
    });
  });

  describe('starting a tour', () => {
    it('runs the tour of the view on screen with the access of the open project', async () => {
      // Arrange
      await router.navigateByUrl('/here');
      TestBed.inject(OpenProjectState).project.set({ ...MEMBER, role: 'Viewer' });

      // Act
      const result = await tours.startCurrent();

      // Assert
      expect(result).toBe('completed');
      expect(launcher.start).toHaveBeenCalledWith(TOUR, {
        access: { canWrite: false, isOwner: false, isAdmin: false },
        params: {},
        returnFocusTo: undefined,
      });
    });

    it('prefers the access the view reports, and falls back while it reports none', async () => {
      // Arrange
      await router.navigateByUrl('/here');
      TestBed.inject(OpenProjectState).project.set(null);
      const reported = signal<TourAccess | null>(null);
      TestBed.runInInjectionContext(() =>
        TestBed.inject(ViewTourAccess).provide('test.view', () => reported()),
      );

      // Act
      await tours.startCurrent();
      reported.set({ canWrite: true, isOwner: true, isAdmin: false });
      await tours.startCurrent();

      // Assert
      expect(launcher.start.mock.calls.map((call) => call[1].access)).toEqual([
        { canWrite: false, isOwner: false, isAdmin: false },
        { canWrite: true, isOwner: true, isAdmin: false },
      ]);
    });

    it('stores Completed and Dismissed at the tour version, and nothing for an aborted or interrupted tour', async () => {
      // Arrange
      await router.navigateByUrl('/here');

      // Act
      await tours.startCurrent();
      launcher.start.mockResolvedValueOnce('dismissed');
      await tours.startCurrent();
      launcher.start.mockResolvedValueOnce('aborted');
      await tours.startCurrent();
      launcher.start.mockResolvedValueOnce('interrupted');
      await tours.startCurrent();

      // Assert
      expect(api.setGuide.mock.calls).toEqual([
        ['tour.test.view', 2, 'Completed'],
        ['tour.test.view', 2, 'Dismissed'],
      ]);
    });

    it('counts a tour as seen until its version is raised', async () => {
      // Arrange
      TestBed.tick();
      await flush();
      await router.navigateByUrl('/here');
      expect(tours.isSeen(TOUR)).toBe(false);

      // Act
      await tours.startCurrent();

      // Assert
      expect(tours.isSeen(TOUR)).toBe(true);
      expect(tours.isSeen({ ...TOUR, version: 1 })).toBe(true);
      expect(tours.isSeen({ ...TOUR, version: 3 })).toBe(false);
    });

    it('opens the view in the picked project first when started elsewhere', async () => {
      // Arrange
      projects.set([{ id: '1', key: 'WEB', name: 'Web', visibility: 'Public', myRole: 'Member' }]);

      // Act
      const result = await tours.start('test.view');

      // Assert
      expect(result).toBe('completed');
      expect(router.url).toBe('/projects/WEB/test');
      expect(launcher.start).toHaveBeenCalledWith(TOUR, {
        access: { canWrite: true, isOwner: false, isAdmin: false },
        params: { projectKey: 'WEB' },
        returnFocusTo: undefined,
      });
    });

    it('does nothing for a view without a tour, or away from a view it cannot open', async () => {
      // Act
      const unknown = await tours.start('nope.view');
      const noProject = await tours.start('test.view');

      // Assert
      expect(unknown).toBeNull();
      expect(noProject).toBeNull();
      expect(launcher.start).not.toHaveBeenCalled();
    });
  });
});
