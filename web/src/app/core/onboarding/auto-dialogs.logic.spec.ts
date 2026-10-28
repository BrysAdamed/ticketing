import {
  AutoDialogSession,
  dueWhatsNew,
  IsSeen,
  nextAutoDialog,
  pickWritableProject,
  predatesAccount,
  sessionKey,
  whatsNewMonthStart,
  whatsNewNewestFirst,
} from './auto-dialogs.logic';
import { WELCOME_GUIDE } from './guides/welcome';
import { WHATS_NEW_ENTRIES, WhatsNewEntry } from './guides/whats-new';

function entry(date: string, version = 1): WhatsNewEntry {
  return { id: `whats-new.${date}`, version, date, title: date, items: [] };
}

function seen(...rows: [string, number][]): IsSeen {
  const map = new Map(rows);
  return (id, version) => (map.get(id) ?? 0) >= version;
}

const WELCOMED: [string, number] = [WELCOME_GUIDE.id, WELCOME_GUIDE.version];
const OLD_USER = '2025-01-10T08:00:00Z';

describe('auto-shown dialogs', () => {
  describe('nextAutoDialog', () => {
    it('shows the welcome dialog first while there is no welcome row', () => {
      // Act
      const next = nextAutoDialog([entry('2026-11')], seen(), OLD_USER);

      // Assert
      expect(next).toEqual({ kind: 'welcome' });
    });

    it('shows the welcome dialog again when its stored version is lower', () => {
      // Act
      const next = nextAutoDialog([], seen([WELCOME_GUIDE.id, WELCOME_GUIDE.version - 1]), null);

      // Assert
      expect(next).toEqual({ kind: 'welcome' });
    });

    it('shows the oldest due What’s new entry once the user was welcomed', () => {
      // Arrange
      const entries = [entry('2027-02'), entry('2026-11'), entry('2027-01')];

      // Act
      const next = nextAutoDialog(entries, seen(WELCOMED), OLD_USER);

      // Assert
      expect(next).toEqual({ kind: 'whats-new', entry: entries[1] });
    });

    it('skips entries the user completed or dismissed at their version', () => {
      // Arrange
      const entries = [entry('2026-11'), entry('2027-01')];

      // Act
      const next = nextAutoDialog(entries, seen(WELCOMED, ['whats-new.2026-11', 1]), OLD_USER);

      // Assert
      expect(next).toEqual({ kind: 'whats-new', entry: entries[1] });
    });

    it('shows an entry again after its version was raised', () => {
      // Arrange
      const entries = [entry('2026-11', 2)];

      // Act
      const next = nextAutoDialog(entries, seen(WELCOMED, ['whats-new.2026-11', 1]), OLD_USER);

      // Assert
      expect(next).toEqual({ kind: 'whats-new', entry: entries[0] });
    });

    it('shows nothing when everything is seen', () => {
      // Act
      const next = nextAutoDialog(
        [entry('2026-11')],
        seen(WELCOMED, ['whats-new.2026-11', 1]),
        OLD_USER,
      );

      // Assert
      expect(next).toBeNull();
    });
  });

  describe('dating', () => {
    it('counts an entry whose month started before the account was created as seen', () => {
      // Assert
      expect(predatesAccount(entry('2026-11'), '2026-11-15T09:00:00Z')).toBe(true);
      expect(predatesAccount(entry('2026-11'), '2026-12-01T00:00:00Z')).toBe(true);
    });

    it('keeps an entry due for accounts created before its month started', () => {
      // Assert
      expect(predatesAccount(entry('2026-11'), '2026-10-31T23:59:59Z')).toBe(false);
      expect(predatesAccount(entry('2026-11'), '2026-11-01T00:00:00Z')).toBe(false);
      expect(predatesAccount(entry('2026-11'), null)).toBe(false);
    });

    it('gives a user created after an entry’s month nothing but newer entries', () => {
      // Arrange
      const entries = [entry('2026-11'), entry('2027-03')];

      // Act
      const due = dueWhatsNew(entries, seen(WELCOMED), '2027-01-20T10:00:00Z');

      // Assert
      expect(due.map((e) => e.id)).toEqual(['whats-new.2027-03']);
    });

    it('reads the month in UTC and rejects malformed dates', () => {
      // Assert
      expect(new Date(whatsNewMonthStart('2026-11')).toISOString()).toBe(
        '2026-11-01T00:00:00.000Z',
      );
      expect(() => whatsNewMonthStart('2026-13')).toThrow();
      expect(() => whatsNewMonthStart('2026-1')).toThrow();
    });

    it('lists entries newest first for Help → What’s new', () => {
      // Act
      const list = whatsNewNewestFirst([entry('2026-11'), entry('2027-04'), entry('2027-01')]);

      // Assert
      expect(list.map((e) => e.date)).toEqual(['2027-04', '2027-01', '2026-11']);
    });
  });

  describe('authored entries', () => {
    it('have ids matching their date, valid months and at least one item', () => {
      for (const e of WHATS_NEW_ENTRIES) {
        expect(e.id).toBe(`whats-new.${e.date}`);
        expect(() => whatsNewMonthStart(e.date)).not.toThrow();
        expect(e.version).toBeGreaterThanOrEqual(1);
        expect(e.items.length).toBeGreaterThan(0);
      }
    });

    it('are unique', () => {
      expect(new Set(WHATS_NEW_ENTRIES.map((e) => e.id)).size).toBe(WHATS_NEW_ENTRIES.length);
    });
  });

  describe('pickWritableProject', () => {
    it('picks the most recently updated project the user can write to', () => {
      // Arrange
      const projects = [
        { key: 'OLD', myRole: 'Member' as const, updatedAt: '2026-01-01T00:00:00Z' },
        { key: 'NEW', myRole: 'Owner' as const, updatedAt: '2026-10-01T00:00:00Z' },
        { key: 'READ', myRole: 'Viewer' as const, updatedAt: '2026-10-20T00:00:00Z' },
        {
          key: 'ARCH',
          myRole: 'Owner' as const,
          updatedAt: '2026-10-25T00:00:00Z',
          archivedAt: '2026-10-26T00:00:00Z',
        },
      ];

      // Act
      const key = pickWritableProject(projects);

      // Assert
      expect(key).toBe('NEW');
    });

    it('returns null for a user who is Viewer everywhere', () => {
      // Act
      const key = pickWritableProject([{ key: 'READ', myRole: 'Viewer' }]);

      // Assert
      expect(key).toBeNull();
    });
  });

  describe('AutoDialogSession', () => {
    it('remembers per user in session storage', () => {
      // Arrange
      const storage = new Map<string, string>();
      const fake = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      } as unknown as Storage;

      // Act
      new AutoDialogSession(fake).markShown('u1');

      // Assert
      const next = new AutoDialogSession(fake);
      expect(storage.get(sessionKey('u1'))).toBe('1');
      expect(next.wasShown('u1')).toBe(true);
      expect(next.wasShown('u2')).toBe(false);
      next.forget('u1');
      expect(next.wasShown('u1')).toBe(false);
    });

    it('falls back to memory when storage throws', () => {
      // Arrange
      const throwing = {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      } as unknown as Storage;
      const session = new AutoDialogSession(throwing);

      // Act
      session.markShown('u1');

      // Assert
      expect(session.wasShown('u1')).toBe(true);
      expect(session.wasShown('u2')).toBe(false);
    });
  });
});
