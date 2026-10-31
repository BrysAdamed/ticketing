import { effect, inject, signal, Signal, untracked } from '@angular/core';
import { ProjectDirectory, ProjectSummary } from './project-directory';

export const PROJECT_SEARCH_DEBOUNCE_MS = 200;

/// Server matches for a project picker's filter text.
export interface ProjectSearch {
  /// Matches for the current term, or null while the picker should filter the directory locally
  /// (the directory holds every readable project, or the term is empty).
  readonly results: Signal<readonly ProjectSummary[] | null>;
  readonly searching: Signal<boolean>;
}

/// Asks `GET /projects?query=` for the picker's term once the directory is capped (D-168), so
/// projects beyond the first `MAX_LISTED_PROJECTS` can still be found. Call in an injection context.
export function injectProjectSearch(term: () => string): ProjectSearch {
  const directory = inject(ProjectDirectory);
  const results = signal<readonly ProjectSummary[] | null>(null);
  const searching = signal(false);
  let token = 0;

  effect((onCleanup) => {
    const text = term().trim();
    const capped = directory.capped();
    const current = ++token;
    if (!capped || !text) {
      untracked(() => {
        results.set(null);
        searching.set(false);
      });
      return;
    }
    untracked(() => searching.set(true));
    const timer = setTimeout(() => {
      directory.search(text).then(
        (items) => {
          if (current !== token) return;
          results.set(items);
          searching.set(false);
        },
        () => {
          if (current !== token) return;
          results.set([]);
          searching.set(false);
        },
      );
    }, PROJECT_SEARCH_DEBOUNCE_MS);
    onCleanup(() => clearTimeout(timer));
  });

  return { results: results.asReadonly(), searching: searching.asReadonly() };
}
