import { Browser, BrowserContext, Page as BrowserPage, TestInfo } from '@playwright/test';
import { LoginPage } from '../../pages/login.page';
import { NotificationsPanel } from '../../pages/notifications.page';
import { ShellPage } from '../../pages/shell.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api, Page } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { PASSWORD, seedUser } from '../identity/identity';

interface TicketSummary {
    key: string;
}

interface NotificationDto {
    id: string;
    kind: string;
    summary: string;
    eventCount: number;
    ticket: { key: string } | null;
    readAt: string | null;
}

interface Member {
    context: BrowserContext;
    page: BrowserPage;
    api: Api;
}

/// Signs a freshly seeded user in through the UI in a browser context of their own and gives
/// them an API helper with that session.
async function signInNewUser(browser: Browser, admin: Api, testInfo: TestInfo): Promise<Member> {
    const user = await seedUser(admin, 'notify');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/login');
    await new LoginPage(page).signIn(user.email, PASSWORD);
    await new ShellPage(page).expectVisible();
    const storageState = testInfo.outputPath('member.json');
    await context.storageState({ path: storageState });
    return { context, page, api: await Api.create(storageState) };
}

async function notifications(api: Api): Promise<NotificationDto[]> {
    return (await api.get<Page<NotificationDto>>('/me/notifications', { limit: 25 })).items;
}

async function unreadCount(api: Api): Promise<number> {
    return (await api.get<{ count: number }>('/me/notifications/unread-count')).count;
}

test.describe('in-app notifications', () => {
    test('a watcher sees collapsed changes in the bell, opens the ticket from the panel and marks all read', async ({
        browser,
        api,
    }, testInfo) => {
        // Arrange: a public project, a ticket the second user watches
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const { key } = await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Checkout totals',
            type: 'UserStory',
        });
        const member = await signInNewUser(browser, api, testInfo);
        await member.api.put(`/tickets/${key}/watchers/me`);
        const bell = new NotificationsPanel(member.page);
        await expect(bell.bell).toBeVisible();
        await expect(bell.badge).toBeHidden();

        // Act: the admin comments and moves the ticket on within five minutes
        await api.post(`/tickets/${key}/comments`, { body: 'Totals are off by one cent.' });
        await api.patch(`/tickets/${key}`, { status: 'InProgress' });
        await expect.poll(() => unreadCount(member.api)).toBe(1);
        const [collapsed] = await notifications(member.api);
        await member.page.reload();

        // Assert: one collapsed notification
        expect(collapsed.eventCount).toBe(2);
        expect(collapsed.ticket?.key).toBe(key);
        await expect(bell.badge).toHaveText('1');
        await expect(bell.bell).toHaveAttribute('aria-label', 'Notifications, 1 unread');

        // Act
        await bell.openWithShortcut();

        // Assert
        const row = bell.row(collapsed.id);
        await expect(bell.panel).toBeVisible();
        await expect(row).toContainText(collapsed.summary);
        await expect(row).toContainText('+1 more');
        await expect(row).toContainText(key);
        await expect(row).toContainText('Checkout totals');

        // Act: open it
        await row.click();

        // Assert: the peek shows the ticket, the panel is gone and the notification is read
        await expect(member.page).toHaveURL(new RegExp(`peek=${key}`));
        await expect(new TicketPage(member.page, 'peek').root).toBeVisible();
        await expect(bell.panel).toBeHidden();
        await expect(bell.badge).toBeHidden();
        await expect.poll(() => unreadCount(member.api)).toBe(0);

        // Act: a new comment arrives, the user comes back to the window
        await api.post(`/tickets/${key}/comments`, { body: 'Fixed on staging.' });
        await expect.poll(() => unreadCount(member.api)).toBe(1);
        await bell.focusWindow();

        // Assert
        await expect(bell.badge).toHaveText('1');

        // Act: mark all read from the Unread filter
        await bell.bell.click();
        await bell.filter('unread').click();
        const [latest] = await notifications(member.api);
        await expect(bell.row(latest.id)).toBeVisible();
        await bell.markAll.click();

        // Assert
        await expect(bell.badge).toBeHidden();
        await expect(bell.markAll).toBeDisabled();
        await expect.poll(() => unreadCount(member.api)).toBe(0);
        await member.page.keyboard.press('Escape');
        await expect(bell.panel).toBeHidden();
        await expect(bell.bell).toBeFocused();

        await member.api.dispose();
        await member.context.close();
    });
});
