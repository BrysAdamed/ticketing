import { AuditEntry } from '../admin.models';

/// Sentence pieces for one audit row: "<actor> <verb> <target>" plus an optional detail line.
export interface AuditDescription {
  verb: string;
  target: string;
  detail: string | null;
}

const VERBS: Record<string, string> = {
  'user.bootstrapped': 'bootstrapped administrator',
  'user.created': 'created user',
  'user.setPasswordLink.issued': 'issued a set-password link for',
  'user.password.set': 'set the first password of',
  'user.password.reset': 'reset the password of',
  'user.password.changed': 'changed the password of',
  'user.field.changed': 'changed',
  'user.deactivated': 'deactivated',
  'user.reactivated': 'reactivated',
  'pat.created': 'created access token',
  'pat.revoked': 'revoked access token',
  'flag.created': 'created flag',
  'flag.updated': 'changed',
  'flag.deleted': 'deleted flag',
  'project.created': 'created project',
  'project.field.changed': 'changed',
  'project.archived': 'archived project',
  'project.unarchived': 'unarchived project',
  'project.deleted': 'deleted project',
};

const FIELD_LABELS: Record<string, string> = {
  displayName: 'display name',
  globalRole: 'role',
  rolloutPercentage: 'rollout',
  targetUserIds: 'target users',
  targetRoles: 'target roles',
};

export function describeAuditEntry(entry: AuditEntry): AuditDescription {
  const target = entry.entityLabel ?? labelFromValues(entry) ?? `(removed ${entry.entityType})`;
  const verb = VERBS[entry.action] ?? entry.action;
  if (entry.field) {
    const field = FIELD_LABELS[entry.field] ?? entry.field;
    return {
      verb: `${verb} ${field} of`,
      target,
      detail: `${formatValue(entry.field, entry.oldValue)} → ${formatValue(entry.field, entry.newValue)}`,
    };
  }
  return { verb, target, detail: detailOf(entry) };
}

export function formatValue(field: string | null, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'rolloutPercentage' && typeof value === 'number') return `${value}%`;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    return field === 'targetUserIds'
      ? `${value.length} user${value.length === 1 ? '' : 's'}`
      : value.join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function detailOf(entry: AuditEntry): string | null {
  const value = asRecord(entry.newValue);
  if (!value) return null;
  switch (entry.action) {
    case 'user.created':
      return `Role ${String(value['globalRole'] ?? 'User')}`;
    case 'pat.created':
      return `${value['scope'] === 'ReadOnly' ? 'Read only' : 'Read & write'}, prefix ${String(value['prefix'] ?? '')}`;
    case 'pat.revoked':
      return value['reason'] === 'userDeactivated' ? 'Owner was deactivated' : null;
    case 'user.deactivated': {
      const count = Number(value['revokedTokens'] ?? 0);
      return count > 0 ? `${count} token${count === 1 ? '' : 's'} revoked` : null;
    }
    default:
      return null;
  }
}

function labelFromValues(entry: AuditEntry): string | null {
  const value = asRecord(entry.newValue) ?? asRecord(entry.oldValue);
  const label = value?.['name'] ?? value?.['key'] ?? value?.['email'];
  return typeof label === 'string' ? label : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
