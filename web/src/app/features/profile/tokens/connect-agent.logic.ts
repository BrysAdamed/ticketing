import { PatSummary, tokenDisplayState } from '@shared/domain/tokens';

export const DEFAULT_AGENT_TOKEN_NAME = 'Claude Code';
export const TOKEN_PLACEHOLDER = 'tkt_...';
/// How often step 3 asks the server whether the token has been used.
export const CONNECTION_POLL_MS = 5000;

export type GuideStepState = 'done' | 'current' | 'upcoming';

export interface ConnectAgentState {
  step1: GuideStepState;
  step2: GuideStepState;
  step3: GuideStepState;
  /// The token whose first use step 3 waits for; null before there is one.
  target: PatSummary | null;
  connected: boolean;
  /// Step 3 should keep polling.
  polling: boolean;
}

function isLive(token: PatSummary, now: number): boolean {
  const state = tokenDisplayState(token, now);
  return state === 'active' || state === 'expiring';
}

/// "Claude Code", or "Claude Code 2", 3… when a listed token already has that name.
export function suggestTokenName(tokens: readonly Pick<PatSummary, 'name'>[]): string {
  const taken = new Set(tokens.map((t) => t.name.trim().toLowerCase()));
  if (!taken.has(DEFAULT_AGENT_TOKEN_NAME.toLowerCase())) return DEFAULT_AGENT_TOKEN_NAME;
  for (let n = 2; ; n++) {
    const name = `${DEFAULT_AGENT_TOKEN_NAME} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/// Step 3 watches the token created in the guide; without one, any live token counts, so a user
/// who connected earlier sees the check pass at once (the checklist item uses the same fact).
export function connectionTarget(
  tokens: readonly PatSummary[],
  createdId: string | null,
  now = Date.now(),
): PatSummary | null {
  if (createdId) return tokens.find((t) => t.id === createdId) ?? null;
  const live = tokens.filter((t) => isLive(t, now));
  return live.find((t) => t.lastUsedAt) ?? live[0] ?? null;
}

export function connectAgentState(
  tokens: readonly PatSummary[],
  createdId: string | null,
  copied: boolean,
  now = Date.now(),
): ConnectAgentState {
  const target = connectionTarget(tokens, createdId, now);
  const connected = !!target?.lastUsedAt;
  const hasToken = target !== null;
  const step2Done = hasToken && (copied || connected);
  return {
    step1: hasToken ? 'done' : 'current',
    step2: step2Done ? 'done' : hasToken ? 'current' : 'upcoming',
    step3: connected ? 'done' : step2Done ? 'current' : 'upcoming',
    target,
    connected,
    polling: hasToken && !connected,
  };
}
