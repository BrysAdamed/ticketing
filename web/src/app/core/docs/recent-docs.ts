import { computed, inject, Injectable, linkedSignal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { docUrl } from './doc-links';
import { DiagramFormat, Doc, DocKind } from './doc.models';

/// A doc the user opened, as shown in the command palette's "Recent docs".
export interface RecentDoc {
  key: string;
  title: string;
  projectKey: string;
  kind: DocKind;
  diagramFormat: DiagramFormat | null;
  folderPath: string;
  url: string;
}

const STORAGE_PREFIX = 'tk-recent-docs:';
export const MAX_RECENT_DOCS = 8;

/// The docs the signed-in user viewed last, newest first, kept per user in localStorage. The doc
/// view calls `visited()`; `forget()` drops a doc that turned out to be deleted or unreadable.
@Injectable({ providedIn: 'root' })
export class RecentDocs {
  private readonly auth = inject(AuthService);
  private readonly userId = computed(() => this.auth.currentUser()?.id ?? null);
  private readonly list = linkedSignal<readonly RecentDoc[]>(() => readRecent(this.userId()));

  readonly items = this.list.asReadonly();

  visited(doc: Doc): void {
    this.update((list) => addRecent(list, toRecentDoc(doc)));
  }

  forget(key: string): void {
    this.update((list) => list.filter((d) => d.key !== key));
  }

  private update(change: (list: readonly RecentDoc[]) => readonly RecentDoc[]): void {
    const next = change(this.list());
    this.list.set(next);
    const userId = this.userId();
    if (!userId) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(next));
    } catch {
      // Storage can be unavailable (private mode); the list then lives for the session only.
    }
  }
}

export function toRecentDoc(doc: Doc): RecentDoc {
  return {
    key: doc.key,
    title: doc.title,
    projectKey: doc.projectKey,
    kind: doc.kind,
    diagramFormat: doc.diagramFormat,
    folderPath: doc.breadcrumb
      .map((c) => c.title.replaceAll('\\', '\\\\').replaceAll('/', '\\/'))
      .join('/'),
    url: docUrl(doc.key, doc.title),
  };
}

/// `doc` moved to the front, without duplicates, at most `MAX_RECENT_DOCS` long.
export function addRecent(list: readonly RecentDoc[], doc: RecentDoc): readonly RecentDoc[] {
  return [doc, ...list.filter((d) => d.key !== doc.key)].slice(0, MAX_RECENT_DOCS);
}

function readRecent(userId: string | null): readonly RecentDoc[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecentDoc).slice(0, MAX_RECENT_DOCS) : [];
  } catch {
    return [];
  }
}

function isRecentDoc(value: unknown): value is RecentDoc {
  const doc = value as Partial<RecentDoc> | null;
  return (
    typeof doc?.key === 'string' &&
    typeof doc.title === 'string' &&
    typeof doc.projectKey === 'string' &&
    typeof doc.url === 'string' &&
    doc.url.startsWith('/') &&
    typeof doc.kind === 'string'
  );
}
