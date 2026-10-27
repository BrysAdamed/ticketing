import { Params } from '@angular/router';

/// Search filter state, mirrored 1:1 in the URL (docs/architecture/search-url-format.md). Values are
/// kept as typed strings so a link with an unknown value round-trips and the API reports it.
export interface SearchFilters {
  project: string[];
  q: string;
  type: string[];
  status: string[];
  category: string[];
  priority: string[];
  severity: string[];
  assignee: string[];
  assigneeNot: string[];
  reporter: string[];
  label: string[];
  version: string;
  parent: string;
  location: string;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  resolvedFrom: string;
  resolvedTo: string;
  fromRegression: boolean;
  sort: SearchSort;
  order: SortOrder | '';
}

export type SearchSort = 'updated' | 'created' | 'priority' | 'key' | 'rank';
export type SortOrder = 'asc' | 'desc';
export type ListField = {
  [K in keyof SearchFilters]: SearchFilters[K] extends string[] ? K : never;
}[keyof SearchFilters];
export type TextField =
  | 'q'
  | 'version'
  | 'parent'
  | 'location'
  | 'createdFrom'
  | 'createdTo'
  | 'updatedFrom'
  | 'updatedTo'
  | 'resolvedFrom'
  | 'resolvedTo';

export const SORTS: readonly { value: SearchSort; label: string }[] = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'key', label: 'Key' },
  { value: 'rank', label: 'Rank' },
];

const LIST_FIELDS: readonly ListField[] = [
  'project',
  'type',
  'status',
  'category',
  'priority',
  'severity',
  'assignee',
  'assigneeNot',
  'reporter',
  'label',
];
const TEXT_FIELDS: readonly TextField[] = [
  'q',
  'version',
  'parent',
  'location',
  'createdFrom',
  'createdTo',
  'updatedFrom',
  'updatedTo',
  'resolvedFrom',
  'resolvedTo',
];
const UPPER_CASE: ReadonlySet<ListField> = new Set(['project']);
const LOWER_CASE: ReadonlySet<ListField> = new Set(['label']);

export const EMPTY_SEARCH: SearchFilters = {
  project: [],
  q: '',
  type: [],
  status: [],
  category: [],
  priority: [],
  severity: [],
  assignee: [],
  assigneeNot: [],
  reporter: [],
  label: [],
  version: '',
  parent: '',
  location: '',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
  resolvedFrom: '',
  resolvedTo: '',
  fromRegression: false,
  sort: 'updated',
  order: '',
};

/// Reads router query params: lists are comma-separated and/or repeated, unknown keys are ignored.
export function parseSearchParams(params: Params): SearchFilters {
  const filters: SearchFilters = { ...EMPTY_SEARCH };
  for (const field of LIST_FIELDS) {
    const values = valuesOf(params[field])
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);
    const normalized = values.map((v) =>
      UPPER_CASE.has(field) ? v.toUpperCase() : LOWER_CASE.has(field) ? v.toLowerCase() : v,
    );
    filters[field] = [...new Set(normalized)];
  }
  for (const field of TEXT_FIELDS) {
    filters[field] = (valuesOf(params[field]).at(-1) ?? '').trim();
  }
  filters.fromRegression = valuesOf(params['fromRegression']).at(-1)?.toLowerCase() === 'true';
  const sort = valuesOf(params['sort']).at(-1)?.toLowerCase();
  filters.sort = SORTS.some((s) => s.value === sort) ? (sort as SearchSort) : 'updated';
  const order = valuesOf(params['order']).at(-1)?.toLowerCase();
  filters.order = order === 'asc' || order === 'desc' ? order : '';
  return filters;
}

/// The canonical query string params (also sent to the API as-is): empty values are omitted and
/// lists are joined with commas, so URLs stay short and readable.
export function toSearchParams(filters: SearchFilters): Record<string, string> {
  const params: Record<string, string> = {};
  for (const field of LIST_FIELDS) {
    if (filters[field].length) params[field] = filters[field].join(',');
  }
  for (const field of TEXT_FIELDS) {
    const value = filters[field].trim();
    if (value) params[field] = value;
  }
  if (filters.fromRegression) params['fromRegression'] = 'true';
  if (filters.sort !== 'updated') params['sort'] = filters.sort;
  if (filters.order) params['order'] = filters.order;
  return params;
}

export function searchQueryString(filters: SearchFilters): string {
  return new URLSearchParams(toSearchParams(filters)).toString();
}

/// The effective direction: the API default is descending for dates and ascending otherwise.
export function effectiveOrder(filters: Pick<SearchFilters, 'sort' | 'order'>): SortOrder {
  if (filters.order) return filters.order;
  return filters.sort === 'updated' || filters.sort === 'created' ? 'desc' : 'asc';
}

export function hasFilters(filters: SearchFilters): boolean {
  const params = toSearchParams({ ...filters, sort: 'updated', order: '' });
  return Object.keys(params).length > 0;
}

export function sameFilters(a: SearchFilters, b: SearchFilters): boolean {
  return searchQueryString(a) === searchQueryString(b);
}

export function toggleValue(
  filters: SearchFilters,
  field: ListField,
  value: string,
): SearchFilters {
  const current = filters[field];
  return {
    ...filters,
    [field]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
  };
}

/// `YYYY-MM-DD` of `daysAgo` days before `now` in UTC (plain dates cover whole UTC days in the API).
export function utcDate(now: Date, daysAgo: number): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo),
  );
  return date.toISOString().slice(0, 10);
}

function valuesOf(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}
