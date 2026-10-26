import { PatScope } from './enums';

export const PAT_STATUSES = ['Active', 'Expired', 'Revoked'] as const;
export type PatStatus = (typeof PAT_STATUSES)[number];

/// A personal access token as the API lists it (never the secret).
export interface PatSummary {
  id: string;
  name: string;
  prefix: string;
  scope: PatScope;
  status: PatStatus;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/// What a token row shows: `expiring` is an active token that ends within 7 days (spec 6.12).
export type TokenDisplayState = 'active' | 'expiring' | 'expired' | 'revoked';

export const TOKEN_EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export function tokenDisplayState(
  token: Pick<PatSummary, 'status' | 'expiresAt' | 'revokedAt'>,
  now = Date.now(),
): TokenDisplayState {
  if (token.revokedAt || token.status === 'Revoked') return 'revoked';
  const expiresAt = new Date(token.expiresAt).getTime();
  if (token.status === 'Expired' || expiresAt <= now) return 'expired';
  return expiresAt - now <= TOKEN_EXPIRY_WARNING_MS ? 'expiring' : 'active';
}

/// "today", "in 1 day", "in 5 days" for an expiry in the future.
export function expiresInLabel(expiresAt: string, now = Date.now()): string {
  const days = Math.floor((new Date(expiresAt).getTime() - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}
