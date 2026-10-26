/// Ready-to-paste MCP client configuration for a freshly created token (spec 6.12, 9.1).
export const MCP_SERVER_NAME = 'ticketing';

export function mcpUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/mcp`;
}

export function claudeCodeCommand(origin: string, token: string): string {
  return `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl(origin)} --header "Authorization: Bearer ${token}"`;
}

/// A project-level `.mcp.json` with one HTTP server.
export function mcpJson(origin: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: mcpUrl(origin),
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

export type ExpiryChoice = 7 | 30 | 90 | 365 | 'custom';

export const EXPIRY_CHOICES: readonly { value: ExpiryChoice; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: 'custom', label: 'Custom date' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_TOKEN_LIFETIME_MS = 365 * DAY_MS;

/// End of the chosen local day, capped at 365 days from now (the server's limit).
export function customExpiry(date: string, now = Date.now()): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const end = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    23,
    59,
    59,
  ).getTime();
  if (Number.isNaN(end) || end <= now) return null;
  return new Date(Math.min(end, now + MAX_TOKEN_LIFETIME_MS - 60_000)).toISOString();
}

/// `YYYY-MM-DD` of a local date, for `<input type="date">` min and max.
export function localDateInput(time: number): string {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function expiryBounds(now = Date.now()): { min: string; max: string } {
  return { min: localDateInput(now + DAY_MS), max: localDateInput(now + MAX_TOKEN_LIFETIME_MS) };
}
