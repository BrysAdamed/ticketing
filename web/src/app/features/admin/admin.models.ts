import { ActivityEntityType, GlobalRole, WriteChannel } from '@shared/domain/enums';
import { PatSummary } from '@shared/domain/tokens';

/// `GET /users` item: pickers, actors, owners.
export interface UserLookup {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
}

/// `GET /admin/users` item.
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  isActive: boolean;
  hasPassword: boolean;
  setPasswordLinkExpiresAt: string | null;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  activeTokenCount: number;
  rowVersion: number;
}

export interface SetPasswordLink {
  token: string;
  path: string;
  expiresAt: string;
}

export interface CreateUserResult {
  user: AdminUser;
  setPasswordLink: SetPasswordLink;
}

export interface AdminToken extends PatSummary {
  user: UserLookup;
}

export interface FeatureFlag {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  targetUsers: UserLookup[];
  targetRoles: GlobalRole[];
  usersOn: number;
  activeUsers: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: UserLookup | null;
  rowVersion: number;
}

export interface FlagInput {
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  targetUserIds: string[];
  targetRoles: GlobalRole[];
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actor: UserLookup | null;
  channel: WriteChannel | null;
  entityType: ActivityEntityType;
  entityId: string;
  entityLabel: string | null;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
}

export const AUDITED_ENTITY_TYPES = [
  'User',
  'PersonalAccessToken',
  'FeatureFlag',
  'Project',
  'AgentPrompt',
] as const;
export type AuditedEntityType = (typeof AUDITED_ENTITY_TYPES)[number];
