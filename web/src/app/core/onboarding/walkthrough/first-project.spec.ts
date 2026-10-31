import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { ApiClient, Query } from '../../api/api-client';
import { PageRequest } from '../../api/page';
import { AuthService } from '../../auth/auth.service';
import { BoardCreator } from '../../boards/create-board';
import { ProjectCreator } from '../../projects/create-project';
import { ProjectSummary } from '../../projects/project-directory';
import { TourLauncher, TourStartOptions } from '../engine/tour-launcher';
import { resumeIndex, stageProgress } from '../engine/tour-logic';
import { OnboardingStateService } from '../onboarding-state.service';
import { DASHBOARD_TOUR_STEPS } from '../tours/dashboard.tours';
import { FirstProjectConditions } from './first-project-conditions';
import { ownedProjects, pickWalkthroughProject, sandboxName } from './first-project.logic';
import { FIRST_PROJECT_CONDITIONS, FIRST_PROJECT_TOUR } from './first-project.tour';
import { FirstProjectWalkthrough } from './first-project-walkthrough';

const project = (key: string, extra: Record<string, unknown> = {}) => ({
  id: key,
  key,
  name: `${key} project`,
  visibility: 'Private' as const,
  myRole: 'Owner' as const,
  isMember: true,
  updatedAt: '2026-10-01T00:00:00Z',
  archivedAt: null,
  ...extra,
});

describe('first-project walkthrough', () => {
  describe('logic', () => {
    it("suggests '<display name>'s sandbox', shortened to fit", () => {
      expect(sandboxName('Kasia')).toBe("Kasia's sandbox");
      expect(sandboxName('  ')).toBe('My sandbox');
      expect(sandboxName('x'.repeat(120))).toHaveLength(100);
    });

    it('counts only explicit, live Owner memberships, newest first', () => {
      const owned = ownedProjects([
        project('OLD', { updatedAt: '2026-01-01T00:00:00Z' }),
        project('NEW', { updatedAt: '2026-10-28T00:00:00Z' }),
        project('ARCH', { archivedAt: '2026-10-01T00:00:00Z' }),
        project('MEM', { myRole: 'Member' }),
        project('ADM', { isMember: false }),
      ]);

      expect(owned.map((p) => p.key)).toEqual(['NEW', 'OLD']);
    });

    it('offers the project the walkthrough last used while the user still owns it', () => {
      const owned = [project('NEW'), project('KS')];

      expect(pickWalkthroughProject(owned, 'KS')?.key).toBe('KS');
      expect(pickWalkthroughProject(owned, 'GONE')?.key).toBe('NEW');
      expect(pickWalkthroughProject([], null)).toBeNull();
    });
  });

  describe('tour data', () => {
    const steps = FIRST_PROJECT_TOUR.steps;

    it('has stable unique ids, seven stages and ends with the dashboard tour steps', () => {
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      expect(stageProgress(steps, 0)).toEqual({ current: 0, total: 7 });
      const dashboard = steps.filter((s) => s.stage === 'dashboard');
      expect(dashboard.map((s) => s.anchor)).toEqual(DASHBOARD_TOUR_STEPS.map((s) => s.anchor));
      expect(dashboard.every((s) => s.route === '/projects/:projectKey/dashboard')).toBe(true);
      expect(steps.at(-1)?.id).toBe('finish');
    });

    it('gives every action-driven step a route, an action and a waiting line', () => {
      const actions = steps.filter((s) => s.advanceWhen);

      expect(actions.map((s) => s.id)).toEqual([
        'create-project',
        'create-ticket',
        'change-status',
        'create-board',
        'place-ticket',
      ]);
      expect(actions.every((s) => s.route && s.action && s.waiting)).toBe(true);
      expect(steps.filter((s) => s.optional).map((s) => s.id)).toEqual(['change-status']);
    });

    it('resumes after a project and a ticket at the status step, or at the board when skipping', () => {
      const holds = steps.map((_, i) => i < 2);

      expect(steps[resumeIndex(steps, holds)].id).toBe('change-status');
      expect(steps[resumeIndex(steps, holds, { skipOptional: true })].id).toBe('create-board');
    });
  });

  describe('conditions', () => {
    let responses: Map<string, unknown>;
    let calls: { path: string; query?: Query }[];
    let conditions: FirstProjectConditions;

    function respond(path: string, body: unknown): void {
      responses.set(path, body);
    }

    beforeEach(() => {
      responses = new Map();
      calls = [];
      const get = (path: string, query?: Query) => {
        calls.push({ path, query });
        if (!responses.has(path)) return throwError(() => new Error(`404 ${path}`));
        const body = responses.get(path);
        return of(typeof body === 'function' ? body(query) : body);
      };
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          {
            provide: ApiClient,
            useValue: {
              writes: new Subject<void>(),
              get,
              list: (path: string, page: PageRequest | undefined, query?: Query) =>
                get(path, { ...query, cursor: page?.cursor }),
            },
          },
          { provide: ProjectCreator, useValue: { open: vi.fn() } },
          { provide: BoardCreator, useValue: { open: vi.fn() } },
        ],
      });
      conditions = TestBed.inject(FirstProjectConditions);
    });

    it('finds the new board on a later page of the boards linking the project', async () => {
      // Arrange
      const board = (id: string, createdAt: string) => ({ id, createdAt, archivedAt: null });
      const pages: Record<string, unknown> = {
        first: {
          items: Array.from({ length: 100 }, (_, i) => board(`b-${i}`, '2026-10-01T00:00:00Z')),
          nextCursor: 'second',
        },
        second: {
          items: [board('b-mine', '2026-10-30T00:00:00Z'), board('b-z', '2026-10-02T00:00:00Z')],
          nextCursor: null,
        },
      };
      respond('/boards', (query: Query) => pages[(query['cursor'] as string) ?? 'first']);
      respond('/tickets/KS-1', { key: 'KS-1', location: { kind: 'Backlog', boardId: null } });
      const params = { projectKey: 'KS', ticketKey: 'KS-1' };

      // Act
      const newest = await conditions.check(FIRST_PROJECT_CONDITIONS.boardLinksProject, params);
      const created = await conditions.check(FIRST_PROJECT_CONDITIONS.boardLinksProject, {
        ...params,
        boardId: 'b-z',
      });

      // Assert
      expect(newest).toEqual({ holds: true, params: { boardId: 'b-mine' } });
      expect(created).toEqual({ holds: true, params: { boardId: 'b-z' } });
      const boardCalls = calls.filter((c) => c.path === '/boards');
      expect(boardCalls.every((c) => c.query?.['projectKey'] === 'KS')).toBe(true);
      expect(boardCalls.map((c) => c.query?.['cursor'] ?? null)).toEqual([
        null,
        'second',
        null,
        'second',
      ]);
    });

    it('sees a project created any other way and learns its key', async () => {
      // Arrange
      respond('/projects', { items: [project('OLD'), project('KS')], nextCursor: null });

      // Act
      const before = await conditions.check(FIRST_PROJECT_CONDITIONS.projectCreated, {
        ownedBefore: 'OLD,KS',
      });
      const after = await conditions.check(FIRST_PROJECT_CONDITIONS.projectCreated, {
        ownedBefore: 'OLD',
      });

      // Assert
      expect(before.holds).toBe(false);
      expect(after).toEqual({ holds: true, params: { projectKey: 'KS' } });
      expect(calls[0].query).toEqual(expect.objectContaining({ mine: true }));
    });

    it('holds for a chosen project only while the user owns it', async () => {
      respond('/projects', { items: [project('KS')], nextCursor: null });

      expect(
        (await conditions.check(FIRST_PROJECT_CONDITIONS.projectCreated, { projectKey: 'KS' }))
          .holds,
      ).toBe(true);
      expect(
        (await conditions.check(FIRST_PROJECT_CONDITIONS.projectCreated, { projectKey: 'XX' }))
          .holds,
      ).toBe(false);
    });

    it("learns the user's newest ticket in the project", async () => {
      // Arrange
      respond('/tickets/search', { items: [{ key: 'KS-2' }], nextCursor: null });

      // Act
      const result = await conditions.check(FIRST_PROJECT_CONDITIONS.ticketCreated, {
        projectKey: 'KS',
      });

      // Assert
      expect(result).toEqual({ holds: true, params: { ticketKey: 'KS-2' } });
      expect(calls[0].query).toEqual(
        expect.objectContaining({ project: 'KS', reporter: 'me', sort: 'created', order: 'desc' }),
      );
    });

    it('reads status changes and the placement from the ticket itself', async () => {
      // Arrange
      const ticket = {
        key: 'KS-1',
        createdAt: '2026-10-28T10:00:00Z',
        statusChangedAt: '2026-10-28T10:00:00Z',
        location: { kind: 'Backlog', boardId: null, boardName: null },
      };
      respond('/tickets/KS-1', ticket);
      respond('/boards', {
        items: [
          { id: 'b-old', createdAt: '2026-10-01T00:00:00Z', archivedAt: null },
          { id: 'b-new', createdAt: '2026-10-28T00:00:00Z', archivedAt: null },
          { id: 'b-arch', createdAt: '2026-10-29T00:00:00Z', archivedAt: '2026-10-29T00:00:00Z' },
        ],
        nextCursor: null,
      });
      const params = { projectKey: 'KS', ticketKey: 'KS-1' };

      // Act
      const unchanged = await conditions.check(FIRST_PROJECT_CONDITIONS.statusChanged, params);
      const board = await conditions.check(FIRST_PROJECT_CONDITIONS.boardLinksProject, params);
      const notPlaced = await conditions.check(FIRST_PROJECT_CONDITIONS.ticketOnBoard, params);
      respond('/tickets/KS-1', {
        ...ticket,
        statusChangedAt: '2026-10-28T10:05:00Z',
        location: { kind: 'Board', boardId: 'b-other', boardName: 'Other' },
      });
      const changed = await conditions.check(FIRST_PROJECT_CONDITIONS.statusChanged, params);
      const placed = await conditions.check(FIRST_PROJECT_CONDITIONS.ticketOnBoard, params);
      const boardOfTicket = await conditions.check(
        FIRST_PROJECT_CONDITIONS.boardLinksProject,
        params,
      );

      // Assert
      expect(unchanged.holds).toBe(false);
      expect(board).toEqual({ holds: true, params: { boardId: 'b-new' } });
      expect(notPlaced.holds).toBe(false);
      expect(changed.holds).toBe(true);
      expect(placed).toEqual({ holds: true, params: { boardId: 'b-other' } });
      expect(boardOfTicket).toEqual({ holds: true, params: { boardId: 'b-other' } });
    });

    it('treats a failed read as not done', async () => {
      expect(
        await conditions.check(FIRST_PROJECT_CONDITIONS.ticketOnBoard, { ticketKey: 'KS-9' }),
      ).toEqual({ holds: false });
    });
  });

  describe('start', () => {
    let owned: ProjectSummary[];
    let started: TourStartOptions[];
    let result: 'completed' | 'dismissed';
    let choice: 'use' | 'create' | undefined;
    let onboarding: { complete: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };
    let dialogOpened: number;

    beforeEach(() => {
      owned = [];
      started = [];
      result = 'completed';
      choice = 'use';
      dialogOpened = 0;
      onboarding = { complete: vi.fn(() => Promise.resolve(true)), dismiss: vi.fn() };
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          {
            provide: ApiClient,
            useValue: {
              writes: new Subject<void>(),
              get: () => of({ name: "Kasia's sandbox 2", key: 'KSS2' }),
              list: () => of({ items: owned, nextCursor: null }),
            },
          },
          {
            provide: AuthService,
            useValue: {
              currentUser: signal({ displayName: 'Kasia', globalRole: 'User' }),
            },
          },
          {
            provide: MatDialog,
            useValue: {
              open: () => {
                dialogOpened++;
                return { afterClosed: () => of(choice) };
              },
            },
          },
          {
            provide: TourLauncher,
            useValue: {
              running: signal(null),
              continue: () => false,
              start: (_: unknown, options: TourStartOptions) => {
                started.push(options);
                return Promise.resolve(result);
              },
            },
          },
          { provide: OnboardingStateService, useValue: onboarding },
          { provide: ProjectCreator, useValue: { open: vi.fn() } },
          { provide: BoardCreator, useValue: { open: vi.fn() } },
        ],
      });
    });

    it('suggests a free sandbox to a user without projects and stores completion', async () => {
      // Act
      await TestBed.inject(FirstProjectWalkthrough).start();

      // Assert
      expect(dialogOpened).toBe(0);
      expect(started[0].params).toEqual({
        ownedBefore: '',
        suggestedName: "Kasia's sandbox 2",
        suggestedKey: 'KSS2',
      });
      expect(started[0].resume).toEqual({ skipOptional: undefined });
      expect(onboarding.complete).toHaveBeenCalledWith(FIRST_PROJECT_TOUR.id, 1);
    });

    it('asks an owner which project to use and resumes on it', async () => {
      // Arrange
      owned = [project('KS')];

      // Act
      await TestBed.inject(FirstProjectWalkthrough).start({ skipOptional: true });

      // Assert
      expect(dialogOpened).toBe(1);
      expect(started[0].params).toEqual({ projectKey: 'KS' });
      expect(started[0].resume).toEqual({ skipOptional: true });
    });

    it('creates a practice project next to the owned ones when asked', async () => {
      // Arrange
      owned = [project('KS')];
      choice = 'create';
      result = 'dismissed';

      // Act
      await TestBed.inject(FirstProjectWalkthrough).start();

      // Assert
      expect(started[0].params?.['ownedBefore']).toBe('KS');
      expect(onboarding.dismiss).toHaveBeenCalledWith(FIRST_PROJECT_TOUR.id, 1);
    });

    it('does nothing when the start choice is cancelled', async () => {
      // Arrange
      owned = [project('KS')];
      choice = undefined;

      // Act
      const outcome = await TestBed.inject(FirstProjectWalkthrough).start();

      // Assert
      expect(outcome).toBeNull();
      expect(started).toEqual([]);
    });
  });
});
