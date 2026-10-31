import { Page } from '@playwright/test';
import { AchievementsPage } from '../../pages/achievements.page';
import { ShellPage } from '../../pages/shell.page';
import { Api, uniqueProjectKey } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';
import {
    enableAchievementsFor,
    PROJECTOR_TIMEOUT_MS,
    tierOf,
    unseenCount,
} from '../../support/achievements';

const UNSEEN_PATH = '/api/v1/me/achievements/unseen';

/// The notification poll also refreshes on window focus; firing it beats waiting a minute.
async function refreshOnFocus(page: Page): Promise<void> {
    const polled = page.waitForResponse((r) => r.url().endsWith(UNSEEN_PATH));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await polled;
}

test.describe('@achievements unlock toast', () => {
    test('an unlock toasts once, not again after a reload, and the dot clears on the tab', async ({
        browser,
        api,
    }) => {
        test.setTimeout(PROJECTOR_TIMEOUT_MS + 90_000);

        // Arrange: a fresh user with the flag on, the app open, then a ticket of theirs
        const user = await seedUser(api, 'unlocker');
        await enableAchievementsFor(api, [user.id]);
        const asUser = await Api.signIn(user.email, PASSWORD);
        await expect.poll(() => tierOf(asUser, 'reporter')).toBe(0);
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const achievements = new AchievementsPage(page);
        await page.goto('/');
        await shell.expectVisible();
        await expect(achievements.dot).toHaveCount(0);
        const projectKey = uniqueProjectKey('U');
        await asUser.createProject({ key: projectKey });
        await asUser.post(`/projects/${projectKey}/tickets`, {
            title: 'Unlocks Reporter',
            type: 'Technical',
        });
        await expect
            .poll(() => tierOf(asUser, 'reporter'), {
                timeout: PROJECTOR_TIMEOUT_MS,
                intervals: [2_000],
            })
            .toBeGreaterThanOrEqual(1);

        // Act: the next poll sees the unlock
        await refreshOnFocus(page);

        // Assert: one toast with the medal's name and tier, and the dot on the avatar
        await expect(achievements.toast).toHaveCount(1);
        await expect(achievements.toast).toContainText('Reporter · Bronze');
        await expect(achievements.toast.getByRole('button', { name: 'View' })).toBeVisible();
        await expect(achievements.dot).toBeVisible();
        await expect(shell.userMenu).toHaveAccessibleName(/new achievements/);

        // Act: dismiss it and poll again
        await achievements.toast.getByRole('button', { name: 'Dismiss' }).click();
        await expect(achievements.toast).toHaveCount(0);
        await refreshOnFocus(page);

        // Assert: the same tier is not toasted twice
        await expect(achievements.toast).toHaveCount(0);

        // Act: reload; the app polls on start
        const polledAfterReload = page.waitForResponse((r) => r.url().endsWith(UNSEEN_PATH));
        await page.reload();
        await polledAfterReload;
        await shell.expectVisible();

        // Assert: still unseen, so the dot stays, but no toast
        await expect(achievements.dot).toBeVisible();
        await expect(achievements.toast).toHaveCount(0);

        // Act: open the tab from the account menu
        await shell.userMenu.click();
        await expect(achievements.menuItem).toContainText('New');
        await achievements.menuItem.click();

        // Assert: opening the tab marks the unlock seen and clears the dot
        await expect(achievements.root).toBeVisible();
        await expect(achievements.dot).toHaveCount(0);
        await expect.poll(() => unseenCount(asUser)).toBe(0);

        await asUser.dispose();
        await context.close();
    });
});
