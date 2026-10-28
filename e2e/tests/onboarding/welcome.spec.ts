import { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides';
import { WELCOME_GUIDE } from '@onboarding/guides/welcome';
import { WHATS_NEW_ENTRIES, WhatsNewEntry } from '@onboarding/guides/whats-new';
import { Onboarding } from '@onboarding/onboarding.models';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { markGuidesSeen } from '../../support/guides';
import { signInAs } from '../../support/session';
import { PASSWORD, uniqueEmail } from '../identity/identity';

interface CreatedUser {
    user: { id: string; email: string; displayName: string };
    setPasswordLink: { token: string };
}

/// A user created through the admin API who set a password, with the given global role.
async function createUser(api: Api, prefix: string, globalRole: 'User' | 'Admin' = 'User') {
    const created = await api.post<CreatedUser>('/admin/users', {
        email: uniqueEmail(prefix),
        displayName: `E2E ${prefix}`,
        globalRole,
    });
    await api.post('/auth/set-password', {
        token: created.setPasswordLink.token,
        password: PASSWORD,
    });
    return created.user;
}

/// Signs the user in with the welcome dialog and What's new due and every other auto-shown guide
/// (checklist card, hints) seen, so only the dialogs under test can appear.
async function signInWithDialogs(
    browser: Browser,
    email: string,
    keep: (id: string) => boolean = (id) => id === WELCOME_GUIDE.id || id.startsWith('whats-new.'),
) {
    const session = await signInAs(browser, { email, password: PASSWORD }, { keepGuides: true });
    await markGuidesSeen(
        session.context.request,
        AUTO_SHOWN_GUIDES.filter((g) => !keep(g.id)),
    );
    return session;
}

async function onboarding(request: APIRequestContext): Promise<Onboarding> {
    const response = await request.get('/api/v1/me/onboarding');
    expect(response.ok()).toBe(true);
    return (await response.json()) as Onboarding;
}

function storedGuide(state: Onboarding, id: string) {
    return state.guides.find((g) => g.guideId === id);
}

/// What's new entries due for an account created at `createdAt`: those whose month starts after it.
function dueFor(createdAt: string): WhatsNewEntry[] {
    const created = Date.parse(createdAt);
    return WHATS_NEW_ENTRIES.filter((e) => {
        const [year, month] = e.date.split('-').map(Number);
        return Date.UTC(year, month - 1, 1) >= created;
    });
}

async function openMyWork(page: Page): Promise<void> {
    await page.goto('/my-work');
    await expect(page.getByTestId('view-my-work.list')).toBeVisible();
}

/// Waits until the onboarding state and any lazy dialog chunk have loaded, so the absence of a dialog means something.
async function settled(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle');
}

async function newTab(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    await openMyWork(page);
    await settled(page);
    return page;
}

test.describe('welcome dialog and What’s new', () => {
    test('a fresh user sees the welcome once: not after a reload, not in a new tab', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await createUser(api, 'welcome');
        const { context, page } = await signInWithDialogs(browser, user.email);
        const welcome = page.getByTestId('welcome-dialog');

        // Act
        await openMyWork(page);

        // Assert: member cards, platform-aware palette keys, the primary action focused
        await expect(welcome).toBeVisible();
        await expect(
            page.getByRole('dialog', { name: `Welcome to Ticketing, ${user.displayName}` }),
        ).toBeVisible();
        await expect(welcome.locator('[data-testid^="welcome-card-"]')).toHaveCount(3);
        await expect(welcome.locator('[data-testid^="welcome-card-"]').first()).toHaveAttribute(
            'data-testid',
            'welcome-card-projects',
        );
        await expect(welcome.getByTestId('welcome-palette-keys')).toHaveText(/Ctrl K|⌘K/);
        await expect(welcome.getByTestId('welcome-tour')).toBeFocused();
        await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0);

        // Act: Esc closes it as Dismissed
        await page.keyboard.press('Escape');

        // Assert
        await expect(welcome).toBeHidden();
        await expect
            .poll(async () => storedGuide(await onboarding(context.request), WELCOME_GUIDE.id))
            .toMatchObject({ state: 'Dismissed', version: WELCOME_GUIDE.version });

        // Act / Assert: a reload in the same session shows no dialog at all (one per session)
        await page.reload();
        await expect(page.getByTestId('view-my-work.list')).toBeVisible();
        await settled(page);
        await expect(welcome).toHaveCount(0);
        await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0);

        // Act / Assert: a new tab is a new session; the welcome stays seen
        const tab = await newTab(context);
        await expect(tab.getByTestId('app-shell')).toBeVisible();
        await expect(tab.getByTestId('welcome-dialog')).toHaveCount(0);
        await context.close();
    });

    test('an Admin gets "Set up your instance" as the first card', async ({ browser, api }) => {
        // Arrange
        const admin = await createUser(api, 'welcome-admin', 'Admin');
        const { context, page } = await signInWithDialogs(browser, admin.email);

        // Act
        await openMyWork(page);

        // Assert
        const cards = page.getByTestId('welcome-dialog').locator('[data-testid^="welcome-card-"]');
        await expect(cards).toHaveCount(3);
        await expect(cards.nth(0)).toHaveAttribute('data-testid', 'welcome-card-setup');
        await expect(cards.nth(0)).toContainText('Set up your instance');
        await expect(cards.nth(0)).toContainText('TICKETING_PUBLIC_URL');
        await expect(page.getByTestId('welcome-card-projects')).toHaveCount(0);
        await context.close();
    });

    test('Show me the checklist completes the welcome and focuses the card on My work', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await createUser(api, 'welcome-checklist');
        const { context, page } = await signInWithDialogs(browser, user.email);
        await page.goto('/projects');
        await expect(page.getByTestId('welcome-dialog')).toBeVisible();

        // Act
        await page.getByTestId('welcome-checklist').click();

        // Assert
        await expect(page).toHaveURL(/\/my-work$/);
        await expect(page.getByTestId('checklist-card')).toBeVisible();
        await expect(page.locator('#checklist-title')).toBeFocused();
        await expect
            .poll(async () => storedGuide(await onboarding(context.request), WELCOME_GUIDE.id))
            .toMatchObject({ state: 'Completed', version: WELCOME_GUIDE.version });
        await context.close();
    });

    test('Take the tour opens a writable project’s backlog and starts its tour', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await createUser(api, 'welcome-tour');
        const project = await api.createProject();
        await api.post(`/projects/${project.key}/tickets`, { title: 'First', type: 'Technical' });
        await api.post(`/projects/${project.key}/members`, { user: user.id, role: 'Member' });
        const { context, page } = await signInWithDialogs(browser, user.email);
        await openMyWork(page);
        await expect(page.getByTestId('welcome-dialog')).toBeVisible();

        // Act
        await page.keyboard.press('Enter');

        // Assert
        await expect(page.getByTestId('welcome-dialog')).toBeHidden();
        await expect(page).toHaveURL(/\/projects\/[A-Z0-9]+\/backlog/);
        await expect(page.getByTestId('tour-popover')).toBeVisible();
        await expect
            .poll(async () => storedGuide(await onboarding(context.request), WELCOME_GUIDE.id))
            .toMatchObject({ state: 'Completed' });
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('tour-popover')).toBeHidden();
        await context.close();
    });

    test('What’s new shows once per entry for users created before its month, and Help reopens it', async ({
        browser,
        api,
    }) => {
        // Arrange: the welcome is behind the user, only What's new is left
        const user = await createUser(api, 'whats-new');
        const { context, page } = await signInWithDialogs(browser, user.email, (id) =>
            id.startsWith('whats-new.'),
        );
        const { createdAt } = await onboarding(context.request);
        const due = dueFor(createdAt);
        const dialog = page.getByTestId('whats-new-dialog');
        const shell = new ShellPage(page);

        // Act
        await openMyWork(page);

        // Assert: the oldest due entry, or nothing when every entry predates the account
        if (due.length > 0) {
            await expect(dialog).toBeVisible();
            await expect(dialog.getByTestId(`whats-new-entry-${due[0].date}`)).toBeVisible();
            await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(due[0].title);
            await dialog.getByTestId('whats-new-done').click();
            await expect(dialog).toBeHidden();
            await expect
                .poll(async () => storedGuide(await onboarding(context.request), due[0].id))
                .toMatchObject({ state: 'Completed', version: due[0].version });
            const tab = await newTab(context);
            await expect(tab.getByTestId('app-shell')).toBeVisible();
            await expect(tab.getByTestId(`whats-new-entry-${due[0].date}`)).toHaveCount(0);
            await tab.close();
        } else {
            await settled(page);
            await expect(dialog).toHaveCount(0);
        }

        // Act: Help → What's new reopens the latest entry at any time
        await shell.openHelp();
        await shell.helpItem('help-whats-new').click();

        // Assert
        const latest = WHATS_NEW_ENTRIES.at(-1)!;
        await expect(dialog).toBeVisible();
        await expect(dialog.getByTestId(`whats-new-entry-${latest.date}`)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await context.close();
    });
});
