import { AuditEntry } from '../admin.models';
import { describeAuditEntry, formatValue } from './audit-format';

function entry(partial: Partial<AuditEntry>): AuditEntry {
  return {
    id: '1',
    occurredAt: '2026-10-26T12:00:00Z',
    actor: null,
    channel: 'Web',
    entityType: 'User',
    entityId: 'u1',
    entityLabel: 'jane@example.com',
    action: 'user.created',
    field: null,
    oldValue: null,
    newValue: null,
    ...partial,
  };
}

describe('describeAuditEntry', () => {
  it('describes a field change with old and new values', () => {
    // Act
    const description = describeAuditEntry(
      entry({
        action: 'user.field.changed',
        field: 'globalRole',
        oldValue: 'User',
        newValue: 'Admin',
      }),
    );

    // Assert
    expect(description).toEqual({
      verb: 'changed role of',
      target: 'jane@example.com',
      detail: 'User → Admin',
    });
  });

  it('describes an agent prompt change by version, and the mode only when it changed', () => {
    // Act
    const guardrails = describeAuditEntry(
      entry({
        entityType: 'AgentPrompt',
        entityLabel: 'Guardrails',
        action: 'agent.prompt.updated',
        field: 'Guardrails',
        oldValue: { version: 1, mode: 'Custom' },
        newValue: { version: 2, mode: 'Custom' },
      }),
    );
    const project = describeAuditEntry(
      entry({
        entityType: 'AgentPrompt',
        entityLabel: 'TKT Bug',
        action: 'agent.prompt.updated',
        field: 'Bug',
        oldValue: { version: 0, mode: 'Inherit' },
        newValue: { version: 1, mode: 'Custom' },
      }),
    );

    // Assert
    expect(guardrails).toEqual({
      verb: 'changed agent prompt',
      target: 'Guardrails',
      detail: 'v1 → v2',
    });
    expect(project).toEqual({
      verb: 'changed agent prompt',
      target: 'TKT Bug',
      detail: '— → v1, Use default → Custom',
    });
  });

  it('falls back to the name stored in the entry when the entity is gone', () => {
    // Act
    const description = describeAuditEntry(
      entry({
        entityType: 'FeatureFlag',
        entityLabel: null,
        action: 'flag.deleted',
        newValue: { key: 'board.lanes' },
      }),
    );

    // Assert
    expect(description.target).toBe('board.lanes');
    expect(description.verb).toBe('deleted flag');
  });

  it('summarises token creation without any secret', () => {
    // Act
    const description = describeAuditEntry(
      entry({
        entityType: 'PersonalAccessToken',
        entityLabel: 'ci',
        action: 'pat.created',
        newValue: { scope: 'ReadOnly', prefix: 'tkt_abcd1234' },
      }),
    );

    // Assert
    expect(description.detail).toBe('Read only, prefix tkt_abcd1234');
  });

  it('drops the target when users act on their own password', () => {
    // Act
    const description = describeAuditEntry(
      entry({
        action: 'user.password.changed',
        entityId: 'u1',
        actor: { id: 'u1', email: 'jane@example.com', displayName: 'Jane', isActive: true },
      }),
    );

    // Assert
    expect(description).toEqual({ verb: 'changed their password', target: '', detail: null });
  });

  it('keeps unknown action codes readable', () => {
    // Act / Assert
    expect(describeAuditEntry(entry({ action: 'project.thing.done' })).verb).toBe(
      'project.thing.done',
    );
  });

  it('names the member and the role in membership entries', () => {
    // Act
    const added = describeAuditEntry(
      entry({
        entityType: 'Project',
        entityLabel: 'Payments',
        action: 'project.member.added',
        newValue: { userId: 'u2', email: 'ann@example.com', role: 'Member' },
      }),
    );
    const changed = describeAuditEntry(
      entry({
        entityType: 'Project',
        entityLabel: 'Payments',
        action: 'project.member.roleChanged',
        field: 'role',
        oldValue: { userId: 'u2', email: 'ann@example.com', role: 'Member' },
        newValue: { userId: 'u2', email: 'ann@example.com', role: 'Owner' },
      }),
    );

    // Assert
    expect(added).toEqual({
      verb: 'added member',
      target: 'ann@example.com',
      detail: 'Payments, as Member',
    });
    expect(changed).toEqual({
      verb: 'changed the role of',
      target: 'ann@example.com',
      detail: 'Payments: Member → Owner',
    });
  });

  it('falls back to "a member" for old entries without an e-mail', () => {
    // Act / Assert
    expect(
      describeAuditEntry(
        entry({
          entityType: 'Project',
          entityLabel: 'Payments',
          action: 'project.member.removed',
          newValue: { userId: 'u2', role: 'Viewer' },
        }),
      ),
    ).toEqual({ verb: 'removed member', target: 'a member', detail: 'Payments, was Viewer' });
  });
});

describe('formatValue', () => {
  it.each([
    ['rolloutPercentage', 25, '25%'],
    ['enabled', true, 'on'],
    ['targetUserIds', ['a', 'b'], '2 users'],
    ['targetRoles', ['Admin', 'User'], 'Admin, User'],
    ['description', null, '—'],
  ])('formats %s %o as %s', (field, value, expected) => {
    // Act / Assert
    expect(formatValue(field, value)).toBe(expected);
  });
});
