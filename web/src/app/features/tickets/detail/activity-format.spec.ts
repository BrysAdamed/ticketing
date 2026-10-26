import { ActivityEntry, UserRef } from '@core/tickets/ticket.models';
import { describeEntry, groupEntries } from './activity-format';

const anna: UserRef = { id: 'u1', email: 'anna@x', displayName: 'Anna', isActive: true };
const bob: UserRef = { id: 'u2', email: 'bob@x', displayName: 'Bob', isActive: false };
const users = new Map([
  [anna.id, anna],
  [bob.id, bob],
]);

function entry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 'e1',
    occurredAt: '2026-10-26T10:00:00Z',
    actor: anna,
    channel: 'Web',
    action: 'ticket.field.changed',
    field: null,
    oldValue: null,
    newValue: null,
    ...overrides,
  };
}

describe('describeEntry', () => {
  it('renders enum field changes with display labels', () => {
    // Act
    const line = describeEntry(entry({ field: 'status', oldValue: 'ToDo', newValue: 'ReadyForTesting' }), users);

    // Assert
    expect(line).toMatchObject({ actor: 'Anna', verb: 'changed status', from: 'To Do', to: 'Ready for Testing' });
  });

  it('resolves assignee ids and marks deactivated users', () => {
    // Act
    const set = describeEntry(entry({ field: 'assignee', oldValue: null, newValue: 'u2' }), users);
    const cleared = describeEntry(entry({ field: 'assignee', oldValue: 'u1', newValue: null }), users);

    // Assert
    expect(set).toMatchObject({ verb: 'set assignee to', to: 'Bob (deactivated)' });
    expect(cleared).toMatchObject({ verb: 'cleared assignee', from: 'Anna' });
  });

  it('describes label diffs, links and the MCP channel', () => {
    // Act
    const labels = describeEntry(entry({ field: 'labels', oldValue: ['api'], newValue: ['ui'] }), users);
    const link = describeEntry(
      entry({ action: 'ticket.link.added', channel: 'Mcp', newValue: { type: 'Blocks', direction: 'Inward', key: 'WEB-9' } }),
      users,
    );

    // Assert
    expect(labels.verb).toBe('added label ui and removed label api');
    expect(link).toMatchObject({ verb: 'linked: is blocked by', ticketKey: 'WEB-9', channel: 'MCP' });
  });
});

describe('groupEntries', () => {
  it('groups lines of one operation by timestamp and actor', () => {
    // Arrange
    const lines = [
      describeEntry(entry({ id: 'a', field: 'status', oldValue: 'ToDo', newValue: 'Done' }), users),
      describeEntry(entry({ id: 'b', field: 'resolution', newValue: 'Done' }), users),
      describeEntry(entry({ id: 'c', occurredAt: '2026-10-25T10:00:00Z', action: 'ticket.created' }), users),
    ];

    // Act
    const groups = groupEntries(lines);

    // Assert
    expect(groups.map((g) => g.lines.length)).toEqual([2, 1]);
  });
});
