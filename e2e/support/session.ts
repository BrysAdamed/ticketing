import { Browser, BrowserContext, BrowserContextOptions, expect, Page } from '@playwright/test';
import { markGuidesSeen } from './guides';

export interface SignInOptions {
    /// Keep the auto-shown guides (welcome, What's new, hints) due, for specs about onboarding.
    keepGuides?: boolean;
    contextOptions?: BrowserContextOptions;
}

export interface SignedInUser {
    context: BrowserContext;
    page: Page;
}

/// Signs a user in through `POST /auth/login` in a browser context of their own (no page is
/// opened yet, so callers can stub routes or add init scripts first) and, unless `keepGuides`,
/// marks every auto-shown guide seen before the SPA loads. The login page itself is covered by
/// the smoke and identity specs.
export async function signInAs(
    browser: Browser,
    credentials: { email: string; password: string },
    options: SignInOptions = {},
): Promise<SignedInUser> {
    const context = await browser.newContext({
        ...options.contextOptions,
        storageState: { cookies: [], origins: [] },
    });
    const response = await context.request.post('/api/v1/auth/login', { data: credentials });
    expect(response.ok(), `login ${credentials.email} → ${response.status()}`).toBe(true);
    if (!options.keepGuides) await markGuidesSeen(context.request);
    return { context, page: await context.newPage() };
}
