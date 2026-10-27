import { APIRequestContext, APIResponse, expect, request } from '@playwright/test';
import { BASE_URL } from './env';

const XSRF_COOKIE = 'XSRF-TOKEN';
const XSRF_HEADER = 'X-XSRF-TOKEN';

export interface Page<T> {
    items: T[];
    nextCursor: string | null;
}

export interface ProjectSummary {
    id: string;
    key: string;
    name: string;
    visibility: 'Private' | 'Public';
}

/// REST helper for seeding and checking data, signed in with a cookie session (storage state)
/// and XSRF-aware: unsafe requests echo the XSRF-TOKEN cookie in the X-XSRF-TOKEN header.
export class Api {
    private constructor(private readonly context: APIRequestContext) {}

    static async create(storageState: string): Promise<Api> {
        const context = await request.newContext({ baseURL: BASE_URL, storageState });
        const api = new Api(context);
        await api.refreshXsrf();
        return api;
    }

    async dispose(): Promise<void> {
        await this.context.dispose();
    }

    async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
        return this.json<T>(await this.context.get(url(path), { params }));
    }

    async post<T>(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
        return this.json<T>(
            await this.context.post(url(path), {
                data: body,
                headers: await this.unsafeHeaders(headers),
            }),
        );
    }

    async patch<T>(path: string, body: unknown, rowVersion?: number): Promise<T> {
        const headers: Record<string, string> =
            rowVersion === undefined ? {} : { 'If-Match': `"${rowVersion}"` };
        return this.json<T>(
            await this.context.patch(url(path), {
                data: body,
                headers: await this.unsafeHeaders(headers),
            }),
        );
    }

    async delete(path: string): Promise<void> {
        const response = await this.context.delete(url(path), {
            headers: await this.unsafeHeaders(),
        });
        await expectOk(response);
    }

    listProjects(): Promise<Page<ProjectSummary>> {
        return this.get<Page<ProjectSummary>>('/projects', { limit: 100 });
    }

    createProject(input: { key?: string; name?: string; visibility?: 'Private' | 'Public' } = {}) {
        const key = input.key ?? uniqueProjectKey();
        return this.post<ProjectSummary>(
            '/projects',
            { key, name: input.name ?? `E2E ${key}`, visibility: input.visibility ?? 'Private' },
            { 'Idempotency-Key': `e2e-${key}` },
        );
    }

    private async refreshXsrf(): Promise<void> {
        await expectOk(await this.context.get(url('/auth/csrf')));
    }

    private async unsafeHeaders(
        extra: Record<string, string> = {},
    ): Promise<Record<string, string>> {
        const { cookies } = await this.context.storageState();
        const token = cookies.find((c) => c.name === XSRF_COOKIE)?.value;
        return token ? { ...extra, [XSRF_HEADER]: token } : extra;
    }

    private async json<T>(response: APIResponse): Promise<T> {
        await expectOk(response);
        return response.status() === 204 ? (undefined as T) : ((await response.json()) as T);
    }
}

/// Unique, valid project key (`^[A-Z][A-Z0-9]{1,9}$`) so parallel tests never collide.
export function uniqueProjectKey(prefix = 'E'): string {
    const suffix = (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase();
    return (prefix + suffix).replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function url(path: string): string {
    return `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
}

async function expectOk(response: APIResponse): Promise<void> {
    expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBe(
        true,
    );
}
