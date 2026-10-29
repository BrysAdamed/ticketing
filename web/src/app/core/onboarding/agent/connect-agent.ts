/// The Connect an AI agent guide (spec 14.8, D-141) is a panel on Profile → Access tokens, opened
/// by this query parameter. Plain data, so links from core and e2e specs need no Angular import.
export const CONNECT_AGENT_HELP_ID = 'help.connect-agent';
export const CONNECT_AGENT_PATH = ['/profile', 'tokens'] as const;
export const CONNECT_AGENT_QUERY = { guide: 'connect-agent' } as const;
export const CONNECT_AGENT_URL = `${CONNECT_AGENT_PATH.join('/')}?guide=${CONNECT_AGENT_QUERY.guide}`;

export function isConnectAgentGuide(guide: string | null | undefined): boolean {
  return guide === CONNECT_AGENT_QUERY.guide;
}
