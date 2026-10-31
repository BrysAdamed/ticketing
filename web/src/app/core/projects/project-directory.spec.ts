import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page, PageRequest } from '../api/page';
import { MAX_LISTED_PROJECTS, ProjectDirectory, ProjectSummary } from './project-directory';
import { findProjects, resolveProject } from './project-search';

function project(key: string, name = `${key} project`): ProjectSummary {
  return { id: key, key, name, visibility: 'Public', myRole: 'Member', archivedAt: null };
}

const late = project('ZLATE', 'Late arrival');

describe('ProjectDirectory', () => {
  function setup(capped: boolean) {
    const filler = Array.from({ length: 100 }, (_, i) =>
      project(`AA${String(i).padStart(3, '0')}`),
    );
    const list = vi.fn(
      (
        _path: string,
        page: PageRequest = {},
        query: Record<string, unknown> = {},
      ): Observable<Page<ProjectSummary>> => {
        if (query['query']) return of({ items: [late], nextCursor: null });
        const index = Number(page.cursor ?? 0);
        return of({ items: filler, nextCursor: capped ? String(index + 1) : null });
      },
    );
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: ApiClient, useValue: { list } }],
    });
    return { directory: TestBed.inject(ProjectDirectory), list };
  }

  const searches = (list: ReturnType<typeof setup>['list']) =>
    list.mock.calls.filter(([, , query]) => !!query?.['query']).length;

  it('filters the loaded list locally while it holds every project', async () => {
    // Arrange
    const { directory, list } = setup(false);

    // Act
    const found = await findProjects(directory, 'aa001');
    const resolved = await resolveProject(directory, 'zlate');

    // Assert
    expect(directory.capped()).toBe(false);
    expect(found.map((p) => p.key)).toEqual(['AA001']);
    expect(resolved).toBeUndefined();
    expect(searches(list)).toBe(0);
  });

  it('asks the server for a term and for an unlisted key once the list is capped', async () => {
    // Arrange
    const { directory, list } = setup(true);

    // Act
    const found = await findProjects(directory, 'late');
    const all = await findProjects(directory, '  ');
    const resolved = await resolveProject(directory, 'zlate');
    const listed = await resolveProject(directory, 'AA002');

    // Assert
    expect(directory.capped()).toBe(true);
    expect(directory.projects()).toHaveLength(MAX_LISTED_PROJECTS);
    expect(found).toEqual([late]);
    expect(all).toHaveLength(MAX_LISTED_PROJECTS);
    expect(resolved).toEqual(late);
    expect(listed?.key).toBe('AA002');
    expect(searches(list)).toBe(2);
  });

  it('lets a find wait for a load that is already on its way', async () => {
    // Arrange
    const reply = new Subject<Page<ProjectSummary>>();
    const list = vi.fn(() => reply);
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: ApiClient, useValue: { list } }],
    });
    const directory = TestBed.inject(ProjectDirectory);
    const loading = directory.load();

    // Act
    const finding = findProjects(directory, 'web');
    reply.next({ items: [project('WEB')], nextCursor: null });
    reply.complete();
    await loading;

    // Assert
    expect((await finding).map((p) => p.key)).toEqual(['WEB']);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
