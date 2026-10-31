import { effect, inject, signal, Signal, untracked } from '@angular/core';
import { MAX_LISTED_PROJECTS, ProjectDirectory, ProjectSummary } from './project-directory';

export const PROJECT_SEARCH_DEBOUNCE_MS = 200;

/// What a project picker says while the directory is capped and nothing is typed yet.
export const CAPPED_PROJECTS_HINT = `Showing the first ${MAX_LISTED_PROJECTS} projects, type to search`;

/// The project's key or name contains `term` (case-insensitive); an empty term matches every project.
export function matchesProject(project: ProjectSummary, term: string): boolean {
  const text = term.trim().toLowerCase();
  return (
    !text || project.key.toLowerCase().includes(text) || project.name.toLowerCase().includes(text)
  );
}

/// Projects whose key or name contains `term`, for an async picker: the directory filtered
/// locally, or the server's matches once the directory is capped and there is a term (D-168).
export async function findProjects(
  directory: ProjectDirectory,
  term: string,
): Promise<readonly ProjectSummary[]> {
  await directory.load();
  const text = term.trim();
  if (text && directory.capped()) return directory.search(text);
  return directory.projects().filter((p) => matchesProject(p, text));
}

/// The active readable project with `key`: from the directory, or asked from the server when the
/// directory is capped and does not hold it. Undefined when there is no such project.
export async function resolveProject(
  directory: ProjectDirectory,
  key: string,
): Promise<ProjectSummary | undefined> {
  await directory.load();
  const upper = key.toUpperCase();
  const listed = directory.byKey(upper);
  if (listed || !directory.capped()) return listed;
  try {
    return (await directory.search(upper)).find((p) => p.key === upper);
  } catch {
    return undefined;
  }
}

/// The projects a picker lists for `term`: the server's matches (`results`) once there are any,
/// otherwise `listed` filtered locally, each kept only when `accept` allows it. Chosen projects
/// missing from those come first, so a selection never disappears from the list.
export function pickerProjects(
  listed: readonly ProjectSummary[],
  term: string,
  results: readonly ProjectSummary[] | null,
  chosen: readonly ProjectSummary[] = [],
  accept: (project: ProjectSummary) => boolean = () => true,
): ProjectSummary[] {
  const remote = term.trim() ? results : null;
  const shown = remote
    ? remote.filter(accept)
    : listed.filter((p) => accept(p) && matchesProject(p, term));
  const keys = new Set(shown.map((p) => p.key));
  const extra: ProjectSummary[] = [];
  for (const project of chosen) {
    if (keys.has(project.key)) continue;
    keys.add(project.key);
    extra.push(project);
  }
  return [...extra, ...shown];
}

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
