import { claudeCodeCommand, customExpiry, mcpJson } from './token-snippets';

const TOKEN = 'tkt_' + 'a'.repeat(40);

describe('token snippets', () => {
  it('builds the Claude Code command against the origin', () => {
    // Act
    const command = claudeCodeCommand('https://tickets.example.com/', TOKEN);

    // Assert
    expect(command).toBe(
      `claude mcp add --transport http ticketing https://tickets.example.com/mcp --header "Authorization: Bearer ${TOKEN}"`,
    );
  });

  it('builds a .mcp.json with an http server and the bearer header', () => {
    // Act
    const json = JSON.parse(mcpJson('http://localhost:8080', TOKEN));

    // Assert
    expect(json).toEqual({
      mcpServers: {
        ticketing: {
          type: 'http',
          url: 'http://localhost:8080/mcp',
          headers: { Authorization: `Bearer ${TOKEN}` },
        },
      },
    });
  });
});

describe('customExpiry', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0).getTime();

  it('ends at the end of the chosen local day', () => {
    // Act
    const iso = customExpiry('2026-11-30', now);

    // Assert
    expect(new Date(iso!).getTime()).toBe(new Date(2026, 10, 30, 23, 59, 59).getTime());
  });

  it('is capped just under 365 days from now', () => {
    // Act
    const iso = customExpiry('2027-10-26', now);

    // Assert
    expect(new Date(iso!).getTime()).toBeLessThan(now + 365 * 24 * 60 * 60 * 1000);
  });

  it.each(['2026-10-25', 'not-a-date', ''])('rejects %s', (value) => {
    // Act / Assert
    expect(customExpiry(value, now)).toBeNull();
  });
});
