import { ProjectRole } from '@shared/domain/enums';
import { WELCOME_GUIDE } from './guides/welcome';
import { WhatsNewEntry } from './guides/whats-new';

/// A dialog that opens by itself (spec 14.1, 14.2).
export type AutoDialog = { kind: 'welcome' } | { kind: 'whats-new'; entry: WhatsNewEntry };

export type IsSeen = (guideId: string, version: number) => boolean;

const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/// First moment (UTC) of an entry's `yyyy-mm` month.
export function whatsNewMonthStart(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Invalid What's new date '${date}'.`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
}

/// An entry whose month starts before the account was created counts as seen (coordinator
/// decision 2): a new user gets the welcome dialog and none of the older highlights.
export function predatesAccount(entry: WhatsNewEntry, createdAt: string | null): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  return !Number.isNaN(created) && whatsNewMonthStart(entry.date) < created;
}

/// The entries the user has not seen yet, oldest first.
export function dueWhatsNew(
  entries: readonly WhatsNewEntry[],
  isSeen: IsSeen,
  createdAt: string | null,
): WhatsNewEntry[] {
  return entries
    .filter((e) => !isSeen(e.id, e.version) && !predatesAccount(e, createdAt))
    .sort((a, b) => whatsNewMonthStart(a.date) - whatsNewMonthStart(b.date));
}

/// The dialog to open by itself, if any: the welcome dialog while the user has no `welcome` row
/// at its version, otherwise the oldest due What's new entry.
export function nextAutoDialog(
  entries: readonly WhatsNewEntry[],
  isSeen: IsSeen,
  createdAt: string | null,
): AutoDialog | null {
  if (!isSeen(WELCOME_GUIDE.id, WELCOME_GUIDE.version)) return { kind: 'welcome' };
  const [entry] = dueWhatsNew(entries, isSeen, createdAt);
  return entry ? { kind: 'whats-new', entry } : null;
}

/// Entries for Help → What's new: newest first.
export function whatsNewNewestFirst(entries: readonly WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries].sort((a, b) => whatsNewMonthStart(b.date) - whatsNewMonthStart(a.date));
}

/// The project whose backlog tour "Take the tour" opens: the most recently updated project, not
/// archived, the user can write to (effective role Owner or Member), or null.
export function pickWritableProject(
  projects: readonly {
    readonly key: string;
    readonly myRole: ProjectRole | null;
    readonly updatedAt?: string;
    readonly archivedAt?: string | null;
  }[],
): string | null {
  return (
    projects
      .filter((p) => !p.archivedAt && (p.myRole === 'Owner' || p.myRole === 'Member'))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]?.key ?? null
  );
}

/// "One auto-shown dialog per browser session" (coordinator decision 2), remembered per user in
/// `sessionStorage`. Storage errors (private mode, quota) fall back to memory.
export class AutoDialogSession {
  private readonly memory = new Set<string>();

  constructor(private readonly storage: Storage | null) {}

  wasShown(userId: string): boolean {
    if (this.memory.has(userId)) return true;
    try {
      return this.storage?.getItem(sessionKey(userId)) === '1';
    } catch {
      return false;
    }
  }

  markShown(userId: string): void {
    this.memory.add(userId);
    try {
      this.storage?.setItem(sessionKey(userId), '1');
    } catch {
      return;
    }
  }

  /// After Restart all guides, so the welcome dialog shows again on the next load.
  forget(userId: string): void {
    this.memory.delete(userId);
    try {
      this.storage?.removeItem(sessionKey(userId));
    } catch {
      return;
    }
  }
}

export function sessionKey(userId: string): string {
  return `tk.onboarding.auto-dialog.${userId}`;
}
