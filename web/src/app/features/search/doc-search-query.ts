import { Params } from '@angular/router';

/// Which list the search page shows; kept in the URL as `scope=docs` (absent means tickets).
export type SearchScope = 'tickets' | 'docs';
export const SCOPE_PARAM = 'scope';

/// Docs search state, mirrored 1:1 in the URL next to `scope=docs`
/// (docs/architecture/search-url-format.md, "Docs search").
export interface DocSearchFilters {
  project: string[];
  q: string;
  kind: string[];
  folder: string;
  mentions: string;
  updatedFrom: string;
  updatedTo: string;
  /// Empty means the API default: relevance with text, otherwise updated.
  sort: '' | 'relevance' | 'updated';
}

export const DOC_KINDS = ['Page', 'Diagram', 'Folder'] as const;

export const EMPTY_DOC_SEARCH: DocSearchFilters = {
  project: [],
  q: '',
  kind: [],
  folder: '',
  mentions: '',
  updatedFrom: '',
  updatedTo: '',
  sort: '',
};

type DocListField = 'project' | 'kind';
type DocTextField = 'q' | 'folder' | 'mentions' | 'updatedFrom' | 'updatedTo';
const LIST_FIELDS: readonly DocListField[] = ['project', 'kind'];
const TEXT_FIELDS: readonly DocTextField[] = [
  'q',
  'folder',
  'mentions',
  'updatedFrom',
  'updatedTo',
];

export function scopeOf(params: Params): SearchScope {
  return lastOf(params[SCOPE_PARAM])?.toLowerCase() === 'docs' ? 'docs' : 'tickets';
}

export function parseDocSearchParams(params: Params): DocSearchFilters {
  const filters: DocSearchFilters = { ...EMPTY_DOC_SEARCH };
  for (const field of LIST_FIELDS) {
    const values = valuesOf(params[field])
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (field === 'project' ? v.toUpperCase() : v));
    filters[field] = [...new Set(values)];
  }
  for (const field of TEXT_FIELDS) filters[field] = (lastOf(params[field]) ?? '').trim();
  const sort = lastOf(params['sort'])?.toLowerCase();
  filters.sort = sort === 'relevance' || sort === 'updated' ? sort : '';
  return filters;
}

/// The API query (`GET /docs/search`): empty values omitted, lists joined with commas.
export function toDocApiParams(filters: DocSearchFilters): Record<string, string> {
  const params: Record<string, string> = {};
  for (const field of LIST_FIELDS)
    if (filters[field].length) params[field] = filters[field].join(',');
  for (const field of TEXT_FIELDS) {
    const value = filters[field].trim();
    if (value) params[field] = value;
  }
  if (filters.sort) params['sort'] = filters.sort;
  return params;
}

/// The search page URL params of a docs search (the API params plus `scope=docs`).
export function toDocSearchParams(filters: DocSearchFilters): Record<string, string> {
  return { [SCOPE_PARAM]: 'docs', ...toDocApiParams(filters) };
}

export function hasDocFilters(filters: DocSearchFilters): boolean {
  return Object.keys(toDocApiParams({ ...filters, sort: '' })).length > 0;
}

export function sameDocFilters(a: DocSearchFilters, b: DocSearchFilters): boolean {
  return (
    new URLSearchParams(toDocApiParams(a)).toString() ===
    new URLSearchParams(toDocApiParams(b)).toString()
  );
}

/// The sort the API applies: relevance needs text.
export function effectiveDocSort(filters: DocSearchFilters): 'relevance' | 'updated' {
  if (!filters.q.trim()) return 'updated';
  return filters.sort || 'relevance';
}

function lastOf(value: unknown): string | undefined {
  return valuesOf(value).at(-1);
}

function valuesOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}
