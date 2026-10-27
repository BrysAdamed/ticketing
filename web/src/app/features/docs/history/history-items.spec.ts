import { describe, expect, it } from 'vitest';
import { DocHistoryItem } from '@core/docs/doc-history.api';
import {
  comparison,
  describeActivity,
  groupByDay,
  linesTitle,
  versionParam,
} from './history-items';

function activity(
  action: string,
  oldValue: unknown = null,
  newValue: unknown = null,
  at = '2026-10-27T10:00:00Z',
): DocHistoryItem {
  return {
    id: action,
    type: 'Activity',
    at,
    actor: null,
    channel: 'Web',
    version: null,
    title: null,
    changeNote: null,
    restoredFrom: null,
    linesAdded: null,
    linesRemoved: null,
    action,
    field: null,
    oldValue,
    newValue,
  };
}

describe('comparison', () => {
  it('compares an older version with the current one', () => {
    expect(comparison(3, 7, null)).toEqual({ from: 3, to: 7 });
  });

  it('shows the changes of the current version', () => {
    expect(comparison(7, 7, null)).toEqual({ from: 6, to: 7 });
    expect(comparison(1, 1, null)).toEqual({ from: null, to: 1 });
  });

  it('compares two chosen versions oldest to newest', () => {
    expect(comparison(6, 7, 2)).toEqual({ from: 2, to: 6 });
    expect(comparison(2, 7, 2)).toEqual({ from: 2, to: 7 });
  });
});

describe('versionParam', () => {
  it('accepts only existing version numbers', () => {
    expect([versionParam('3', 7), versionParam('7', 7)]).toEqual([3, 7]);
    expect([
      versionParam(null, 7),
      versionParam('0', 7),
      versionParam('8', 7),
      versionParam('2x', 7),
    ]).toEqual([null, null, null, null]);
  });
});

describe('describeActivity', () => {
  it('describes the doc actions with their values', () => {
    expect(describeActivity(activity('doc.renamed', 'Draft', 'Plan')).text).toBe(
      'Renamed from “Draft” to “Plan”',
    );
    expect(describeActivity(activity('doc.moved', null, 'WEB-D-3')).text).toBe('Moved to WEB-D-3');
    expect(describeActivity(activity('doc.moved', 'WEB-D-3', null)).text).toBe(
      'Moved to the top level',
    );
    expect(
      describeActivity(activity('doc.attachment.added', null, { fileName: 'flow.png' })).text,
    ).toBe('Attached flow.png');
    expect(describeActivity(activity('doc.comment.edited')).text).toBe('Edited a comment');
    expect(describeActivity(activity('doc.something.new')).text).toBe('doc.something.new');
  });
});

describe('groupByDay', () => {
  it('groups newest-first entries under Today, Yesterday and dates', () => {
    // Arrange
    const now = new Date(2026, 9, 27, 18, 0);
    const items = [
      activity('a', null, null, new Date(2026, 9, 27, 9, 0).toISOString()),
      activity('b', null, null, new Date(2026, 9, 27, 1, 0).toISOString()),
      activity('c', null, null, new Date(2026, 9, 26, 23, 0).toISOString()),
      activity('d', null, null, new Date(2026, 9, 14, 12, 0).toISOString()),
      activity('e', null, null, new Date(2025, 11, 31, 12, 0).toISOString()),
    ];

    // Act
    const days = groupByDay(items, now);

    // Assert
    expect(days.map((d) => d.items.map((i) => i.id).join(''))).toEqual(['ab', 'c', 'd', 'e']);
    expect(days.slice(0, 2).map((d) => d.label)).toEqual(['Today', 'Yesterday']);
    expect(days[3].label).toContain('2025');
  });
});

describe('linesTitle', () => {
  it('spells out the counts against the version before', () => {
    // Arrange
    const v5 = {
      ...activity('v5'),
      type: 'Version' as const,
      version: 5,
      linesAdded: 12,
      linesRemoved: 3,
    };
    const v1 = {
      ...activity('v1'),
      type: 'Version' as const,
      version: 1,
      linesAdded: 1,
      linesRemoved: 0,
    };

    // Act
    const titles = [v5, v1].map(linesTitle);

    // Assert
    expect(titles).toEqual(['12 lines added, 3 removed against v4', '1 line added, 0 removed']);
  });
});
