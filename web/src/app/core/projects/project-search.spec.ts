import {
  Injector,
  provideZonelessChangeDetection,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ProjectDirectory, ProjectSummary } from './project-directory';
import { injectProjectSearch, PROJECT_SEARCH_DEBOUNCE_MS } from './project-search';

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
