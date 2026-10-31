import {
  Injector,
  provideZonelessChangeDetection,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProjectDirectory, ProjectSummary } from './project-directory';
import { injectProjectSearch, pickerProjects, PROJECT_SEARCH_DEBOUNCE_MS } from './project-search';

const late: ProjectSummary = {
  id: 'late',
  key: 'ZLATE',
  name: 'Late',
  visibility: 'Public',
  myRole: 'Member',
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('injectProjectSearch', () => {
  function setup(capped: boolean) {
    const directory = { capped: signal(capped), search: vi.fn(async () => [late]) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProjectDirectory, useValue: directory },
      ],
    });
    const term = signal('');
    const search = runInInjectionContext(TestBed.inject(Injector), () =>
      injectProjectSearch(() => term()),
    );
    return { directory, term, search };
  }

  it('leaves filtering to the picker while the directory holds every project', async () => {
    // Arrange
    const { directory, term, search } = setup(false);

    // Act
    term.set('late');
    TestBed.tick();
    await wait(PROJECT_SEARCH_DEBOUNCE_MS + 20);

    // Assert
    expect(search.results()).toBeNull();
    expect(directory.search).not.toHaveBeenCalled();
  });

  it('asks the server once the directory is capped, debounced', async () => {
    // Arrange
    const { directory, term, search } = setup(true);

    // Act
    term.set('la');
    TestBed.tick();
    term.set('late');
    TestBed.tick();
    expect(search.searching()).toBe(true);
    await wait(PROJECT_SEARCH_DEBOUNCE_MS + 20);

    // Assert
    expect(directory.search).toHaveBeenCalledTimes(1);
    expect(directory.search).toHaveBeenCalledWith('late');
    expect(search.results()).toEqual([late]);
    expect(search.searching()).toBe(false);
  });

  it('goes back to local filtering when the term is cleared', async () => {
    // Arrange
    const { term, search } = setup(true);
    term.set('late');
    TestBed.tick();
    await wait(PROJECT_SEARCH_DEBOUNCE_MS + 20);

    // Act
    term.set('  ');
    TestBed.tick();

    // Assert
    expect(search.results()).toBeNull();
  });
});

describe('pickerProjects', () => {
  const project = (key: string, name = key, extra: Partial<ProjectSummary> = {}) =>
    ({ id: key, key, name, visibility: 'Public', myRole: 'Member', ...extra }) as ProjectSummary;
  const listed = [project('API', 'Gateway'), project('OPS', 'Platform Ops'), project('WEB')];

  it('filters the listed projects by key or name while there are no server matches', () => {
    // Act
    const byName = pickerProjects(listed, 'gate', null);
    const byKey = pickerProjects(listed, ' we ', null);
    const all = pickerProjects(listed, '', null);

    // Assert
    expect(byName.map((p) => p.key)).toEqual(['API']);
    expect(byKey.map((p) => p.key)).toEqual(['WEB']);
    expect(all.map((p) => p.key)).toEqual(['API', 'OPS', 'WEB']);
  });

  it('lists the server matches for a term instead of the directory', () => {
    // Act
    const shown = pickerProjects(listed, 'late', [late]);
    const cleared = pickerProjects(listed, '', [late]);

    // Assert
    expect(shown).toEqual([late]);
    expect(cleared.map((p) => p.key)).toEqual(['API', 'OPS', 'WEB']);
  });

  it('keeps chosen projects first when the list does not hold them, never twice', () => {
    // Act
    const shown = pickerProjects(listed, 'ops', null, [late, listed[1], late]);

    // Assert
    expect(shown.map((p) => p.key)).toEqual(['ZLATE', 'OPS']);
  });

  it('drops listed and matched projects the picker does not accept, but not chosen ones', () => {
    // Arrange
    const viewer = project('VIEW', 'Read only', { myRole: 'Viewer' });
    const accept = (p: ProjectSummary) => p.myRole !== 'Viewer';

    // Act
    const local = pickerProjects([...listed, viewer], '', null, [], accept);
    const remote = pickerProjects(listed, 'o', [viewer, late], [], accept);
    const chosen = pickerProjects(listed, '', null, [viewer], accept);

    // Assert
    expect(local.map((p) => p.key)).toEqual(['API', 'OPS', 'WEB']);
    expect(remote).toEqual([late]);
    expect(chosen.map((p) => p.key)).toEqual(['VIEW', 'API', 'OPS', 'WEB']);
  });
});
