import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClient, Query } from '@core/api/api-client';
import { PageRequest } from '@core/api/page';
import { MAX_LISTED_PROJECTS, ProjectSummary } from '@core/projects/project-directory';
import {
  PROJECT_FILTER_DEBOUNCE_MS,
  projectQueryFor,
  ProjectsListStore,
} from './projects-list.store';

function project(key: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: key,
    key,
    name: `${key} project`,
    visibility: 'Public',
    myRole: 'Member',
    isMember: false,
    ...overrides,
  };
}

function keys(count: number, prefix: string): ProjectSummary[] {
  return Array.from({ length: count }, (_, i) => project(`${prefix}${String(i).padStart(4, '0')}`));
}

/// Serves `GET /projects` from a fixed list the way the API does: key order, `query` over key or
/// name, `visibility`, `mine`, keyset cursor.
class FakeApi {
  readonly calls: Query[] = [];

  constructor(private readonly all: ProjectSummary[]) {}

  list(_path: string, page: PageRequest = {}, query: Query = {}) {
    this.calls.push(query);
    const text = typeof query['query'] === 'string' ? query['query'].toLowerCase() : '';
    const matching = this.all.filter(
      (p) =>
        (!text || p.key.toLowerCase().includes(text) || p.name.toLowerCase().includes(text)) &&
        (!query['visibility'] || p.visibility === query['visibility']) &&
        (!query['mine'] || p.isMember === true),
    );
    const start = page.cursor ? matching.findIndex((p) => p.key > page.cursor!) : 0;
    const limit = page.limit ?? 25;
    const items = start < 0 ? [] : matching.slice(start, start + limit);
    const more = start >= 0 && start + limit < matching.length;
    return of({ items, nextCursor: more ? items[items.length - 1].key : null });
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('ProjectsListStore with more projects than the list holds', () => {
  function setup(projects: ProjectSummary[]): { store: ProjectsListStore; api: FakeApi } {
    const api = new FakeApi(projects);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ProjectsListStore,
        { provide: ApiClient, useValue: api },
      ],
    });
    return { store: TestBed.inject(ProjectsListStore), api };
  }

  it('filters locally while every project is loaded', async () => {
    // Arrange
    const { store, api } = setup([project('ALPHA'), project('BETA')]);
    await store.load();

    // Act
    store.query.set('bet');
    TestBed.tick();
    await wait(PROJECT_FILTER_DEBOUNCE_MS + 50);

    // Assert
    expect(store.capped()).toBe(false);
    expect(store.truncated()).toBe(false);
    expect(store.projects().map((p) => p.key)).toEqual(['BETA']);
    expect(api.calls.some((q) => q['query'])).toBe(false);
  });

  it('says the list is cut and finds a project after the first 1000 through the API', async () => {
    // Arrange
    const late = project('ZLATE', { name: 'Late arrival' });
    const { store, api } = setup([...keys(MAX_LISTED_PROJECTS + 5, 'A'), late]);
    await store.load();

    // Assert the unfiltered list
    expect(store.capped()).toBe(true);
    expect(store.truncated()).toBe(true);
    expect(store.projects()).toHaveLength(MAX_LISTED_PROJECTS);
    expect(store.projects().some((p) => p.key === 'ZLATE')).toBe(false);

    // Act
    store.query.set('late arr');
    TestBed.tick();
    expect(store.searching()).toBe(true);
    await wait(PROJECT_FILTER_DEBOUNCE_MS + 50);

    // Assert
    expect(store.searching()).toBe(false);
    expect(store.truncated()).toBe(false);
    expect(store.projects().map((p) => p.key)).toEqual(['ZLATE']);
    expect(api.calls.at(-1)).toMatchObject({ query: 'late arr' });
  });

  it('asks the API for a segment once the list is cut', async () => {
    // Arrange
    const mine = project('ZMINE', { visibility: 'Private', isMember: true });
    const { store, api } = setup([...keys(MAX_LISTED_PROJECTS, 'A'), mine]);
    await store.load();

    // Act
    store.filter.set('mine');
    TestBed.tick();
    await wait(PROJECT_FILTER_DEBOUNCE_MS + 50);

    // Assert
    expect(store.projects().map((p) => p.key)).toEqual(['ZMINE']);
    expect(api.calls.at(-1)).toMatchObject({ mine: true });
  });

  it('maps the page filters to the API query', () => {
    // Act / Assert
    expect(projectQueryFor('  web ', 'private', true)).toEqual({
      query: 'web',
      includeArchived: true,
      visibility: 'Private',
      mine: undefined,
    });
    expect(projectQueryFor('', 'mine', false)).toEqual({
      query: undefined,
      includeArchived: undefined,
      visibility: undefined,
      mine: true,
    });
  });
});
