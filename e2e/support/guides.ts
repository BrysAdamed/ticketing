import { APIRequestContext, expect, request } from '@playwright/test';
import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides';
import { GuideRef } from '@onboarding/onboarding.models';
import { BASE_URL } from './env';

const XSRF_COOKIE = 'XSRF-TOKEN';
const XSRF_HEADER = 'X-XSRF-TOKEN';

/// Records `Completed` at the current version for each guide (by default every guide the SPA
/// shows by itself), so a welcome dialog, What's new entry or hint never covers what a spec drives.
/// `request` must carry a signed-in cookie session, e.g. `page.request` or `context.request`.
export async function markGuidesSeen(
    request: APIRequestContext,
    guides: readonly GuideRef[] = AUTO_SHOWN_GUIDES,
): Promise<void> {
    const xsrf = await xsrfToken(request);
    for (const guide of guides) {
        const response = await request.put(
            `/api/v1/me/onboarding/guides/${encodeURIComponent(guide.id)}`,
            {
                data: { version: guide.version, state: 'Completed' },
                headers: { [XSRF_HEADER]: xsrf },
            },
        );
        expect(response.ok(), `${guide.id} → ${response.status()} ${await response.text()}`).toBe(
            true,
        );
    }
}

/// The same for a user whose browser must still go through the login page: signs in with a
/// throwaway API session, marks the guides and ends that session.
export async function markGuidesSeenAs(
    credentials: { email: string; password: string },
    guides: readonly GuideRef[] = AUTO_SHOWN_GUIDES,
): Promise<void> {
    const context = await request.newContext({
        baseURL: BASE_URL,
        storageState: { cookies: [], origins: [] },
    });
    try {
        const login = await context.post('/api/v1/auth/login', { data: credentials });
        expect(
            login.ok(),
            `login ${credentials.email} → ${login.status()} ${await login.text()}`,
        ).toBe(true);
        await markGuidesSeen(context, guides);
    } finally {
        await context.dispose();
    }
}

async function xsrfToken(request: APIRequestContext): Promise<string> {
    const current = await readCookie(request);
    if (current) return current;
    expect((await request.get('/api/v1/auth/csrf')).ok()).toBe(true);
    const issued = await readCookie(request);
    expect(issued, 'XSRF-TOKEN cookie after GET /auth/csrf').toBeTruthy();
    return issued!;
}

async function readCookie(request: APIRequestContext): Promise<string | undefined> {
    const { cookies } = await request.storageState();
    return cookies.find((c) => c.name === XSRF_COOKIE)?.value;
}
