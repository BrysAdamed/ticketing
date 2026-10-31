import { Injector, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { BoardsApi } from '../boards/boards.api';
import { NavigationContext } from '../layout/navigation-context';
import { ProjectDirectory } from '../projects/project-directory';
import { RegressionsApi } from '../testing/testing.api';
import { findTourTarget } from './tour-target-finder';
import { TourTargets } from './tour-targets';

const PROJECTS = [
  { key: 'READ', myRole: 'Viewer', updatedAt: '2026-10-02T00:00:00Z' },
  { key: 'WEB', myRole: 'Member', updatedAt: '2026-10-01T00:00:00Z' },
];

describe('findTourTarget', () => {
  let search: ReturnType<typeof vi.fn>;
  let boards: ReturnType<typeof vi.fn>;
  let sessions: ReturnType<typeof vi.fn>;

  function setup(projects: readonly object[] = PROJECTS): Injector {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiClient, useValue: { get: search } },
        { provide: BoardsApi, useValue: { list: boards } },
        { provide: RegressionsApi, useValue: { list: sessions } },
        {
          provide: ProjectDirectory,
          useValue: { load: vi.fn().mockResolvedValue(undefined), projects: signal(projects) },
        },
        { provide: NavigationContext, useValue: { projectKey: signal(null) } },
      ],
    });
    return TestBed.inject(Injector);
  }

  beforeEach(() => {
    search = vi.fn().mockReturnValue(of({ items: [] }));
    boards = vi.fn().mockReturnValue(of({ items: [] }));
    sessions = vi.fn().mockReturnValue(of({ items: [] }));
  });

  it('opens the latest ticket of the best writable project', async () => {
    // Arrange
    const injector = setup();
    search.mockReturnValue(of({ items: [{ key: 'WEB-7' }] }));

    // Act
    const target = await findTourTarget(injector, 'ticket');

    // Assert
    expect(target).toEqual({ url: '/tickets/WEB-7' });
    expect(search).toHaveBeenCalledWith('/tickets/search', { project: 'WEB', limit: 1 });
  });

  it('falls back to a ticket of any project, else none', async () => {
    // Arrange
    const injector = setup();
    search
      .mockReturnValueOnce(of({ items: [] }))
      .mockReturnValueOnce(of({ items: [{ key: 'READ-1' }] }));

    // Act
    const found = await findTourTarget(injector, 'ticket');
    const none = await findTourTarget(injector, 'ticket');

    // Assert
    expect(found).toEqual({ url: '/tickets/READ-1' });
    expect(search).toHaveBeenCalledWith('/tickets/search', { limit: 1 });
    expect(none).toBeNull();
  });

  it('prefers a board the user owns over any other board', async () => {
    // Arrange
    const injector = setup();
    boards
      .mockReturnValueOnce(of({ items: [] }))
      .mockReturnValueOnce(of({ items: [{ id: 'b-1' }] }));

    // Act
    const target = await findTourTarget(injector, 'board');

    // Assert
    expect(target).toEqual({ url: '/boards/b-1' });
    expect(boards.mock.calls.map((call) => call[0])).toEqual([{ mine: true }, { mine: false }]);
  });

  it('opens a session in progress in one of the first projects, else the latest of the best', async () => {
    // Arrange
    const injector = setup();
    sessions.mockImplementation((projectKey: string, query: { status?: string[] }) =>
      of({
        items: projectKey === 'READ' && query.status ? [{ key: 'READ-R-2' }] : [],
      }),
    );

    // Act
    const running = await findTourTarget(injector, 'regression-session');
    sessions.mockImplementation((projectKey: string, query: { status?: string[] }) =>
      of({ items: projectKey === 'WEB' && !query.status ? [{ key: 'WEB-R-1' }] : [] }),
    );
    const latest = await findTourTarget(injector, 'regression-session');

    // Assert
    expect(running).toEqual({
      url: '/projects/READ/regressions/READ-R-2',
      projectKey: 'READ',
    });
    expect(latest).toEqual({ url: '/projects/WEB/regressions/WEB-R-1', projectKey: 'WEB' });
  });

  it('finds no session without a project', async () => {
    // Arrange
    const injector = setup([]);

    // Act / Assert
    expect(await findTourTarget(injector, 'regression-session')).toBeNull();
    expect(sessions).not.toHaveBeenCalled();
  });
});

describe('TourTargets', () => {
  it('keeps what prepare found, and forgets it when a later lookup fails', async () => {
    // Arrange
    const search = vi
      .fn()
      .mockReturnValueOnce(of({ items: [{ key: 'WEB-1' }] }))
      .mockReturnValue(throwError(() => new Error('offline')));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ApiClient, useValue: { get: search } },
        {
          provide: ProjectDirectory,
          useValue: { load: vi.fn().mockResolvedValue(undefined), projects: signal(PROJECTS) },
        },
        { provide: NavigationContext, useValue: { projectKey: signal(null) } },
      ],
    });
    const targets = TestBed.inject(TourTargets);

    // Act
    await targets.prepare('ticket');
    const found = targets.get('ticket');
    await targets.prepare('ticket');

    // Assert
    expect(found).toEqual({ url: '/tickets/WEB-1' });
    expect(targets.get('ticket')).toBeNull();
    expect(targets.get('board')).toBeNull();
  });
});
