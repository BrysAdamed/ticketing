import { APIRequestContext, expect, request } from '@playwright/test';
import { BASE_URL } from './env';

const PROTOCOL_VERSION = '2025-06-18';

/// A minimal MCP client over Streamable HTTP (stateless server, spec 9.1): what Claude Code sends,
/// without the SDK. Responses come as JSON or as one SSE `data:` event.
export class McpSession {
    private nextId = 1;

    private constructor(private readonly http: APIRequestContext) {}

    static async connect(token: string): Promise<McpSession> {
        const http = await request.newContext({
            baseURL: BASE_URL,
            extraHTTPHeaders: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json, text/event-stream',
            },
        });
        return new McpSession(http);
    }

    async initialize(): Promise<{ instructions?: string; serverInfo: { name: string } }> {
        return this.call('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'e2e', version: '1.0.0' },
        });
    }

    async callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
        const result = await this.call<{ isError?: boolean; content: { text: string }[] }>(
            'tools/call',
            { name, arguments: args },
        );
        expect(result.isError ?? false, result.content[0]?.text).toBe(false);
        return JSON.parse(result.content[0].text) as T;
    }

    async dispose(): Promise<void> {
        await this.http.dispose();
    }

    private async call<T>(method: string, params: unknown): Promise<T> {
        const response = await this.http.post('/mcp', {
            data: { jsonrpc: '2.0', id: this.nextId++, method, params },
            headers: { 'MCP-Protocol-Version': PROTOCOL_VERSION },
        });
        const body = await response.text();
        expect(response.ok(), `${method} → ${response.status()} ${body}`).toBe(true);
        const json = (response.headers()['content-type'] ?? '').includes('text/event-stream')
            ? body
                  .split('\n')
                  .filter((line) => line.startsWith('data:'))
                  .map((line) => line.slice(5).trim())
                  .join('')
            : body;
        const message = JSON.parse(json) as { result?: T; error?: { message: string } };
        expect(message.error, message.error?.message).toBeUndefined();
        return message.result as T;
    }
}
