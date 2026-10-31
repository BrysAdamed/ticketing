/// What an LLM writes when asked for a diagram (the same source the MCP tool accepts).
export const LLM_FLOWCHART = [
    'flowchart LR',
    '  client([Browser]) -->|HTTPS| web[nginx + SPA]',
    '  web --> api[Ticketing API]',
    '  api --> db[(PostgreSQL)]',
    '  api -. MCP .-> llm{{Claude Code}}',
].join('\n');
