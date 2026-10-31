import {
    Browser,
    BrowserContext,
    BrowserContextOptions,
    expect,
    Page,
    request,
} from '@playwright/test';
import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides';
import { GuideRef } from '@onboarding/onboarding.models';
import { BASE_URL } from './env';
import { markGuidesSeen } from './guides';

export interface SignInOptions {
    /// Keep auto-shown guides (welcome, What's new, checklist card, hints) due, for specs about
    /// onboarding: `true` keeps all of them, a predicate only the matching ones (for example only
    /// hints, so the welcome dialog cannot open over them).
    keepGuides?: boolean | ((guide: GuideRef) => boolean);
    contextOptions?: BrowserContextOptions;
}

export interface SignedInUser {
    context: BrowserContext;
    page: Page;
}

/// Signs a user in through `POST /auth/login` and opens a browser context of their own with that
/// session (no page is opened yet, so callers can stub routes or add init scripts first). Unless
/// `keepGuides`, every auto-shown guide is marked seen before the SPA loads. Login and guides go
/// through a Node-side request context, so the browser only receives the finished cookies. The
/// login page itself is covered by the smoke and identity specs.
export async function signInAs(
    browser: Browser,
    credentials: { email: string; password: string },
    options: SignInOptions = {},
): Promise<SignedInUser> {
    const session = await request.newContext({
        baseURL: BASE_URL,
        storageState: { cookies: [], origins: [] },
    });
    try {
        const response = await session.post('/api/v1/auth/login', { data: credentials });
        expect(response.ok(), `login ${credentials.email} → ${response.status()}`).toBe(true);
        const keep = options.keepGuides;
        if (keep !== true)
            await markGuidesSeen(
                session,
                typeof keep === 'function' ? AUTO_SHOWN_GUIDES.filter((g) => !keep(g)) : undefined,
            );
        const context = await browser.newContext({
            ...options.contextOptions,
            storageState: await session.storageState(),
        });
        return { context, page: await context.newPage() };
    } finally {
        await session.dispose();
    }
}
