import { AchievementsPage } from '../../pages/achievements.page';
import { Api, uniqueProjectKey } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

const FLAG = 'achievements';
/// The projector runs every TICKETING_ACHIEVEMENTS_INTERVAL; the e2e stack sets it short.
const PROJECTOR_TIMEOUT_MS = 120_000;

interface Flag {
    key: string;
    targetUsers: { id: string }[];
}

interface MyAchievement {
    id: string | null;
    tier: number;
}

/// Turns the flag on for these users only, keeping any users other specs targeted.
async function enableFor(api: Api, userIds: string[]): Promise<void> {
    const flag = (await api.get<Flag[]>('/admin/flags')).find((f) => f.key === FLAG);
    if (!flag) {
        await api.post('/admin/flags', {
            key: FLAG,
            description: 'Achievements (TKT-61)',
            enabled: true,
            rolloutPercentage: 0,
            targetUserIds: userIds,
        });
        return;
    }
    const targets = new Set([...flag.targetUsers.map((u) => u.id), ...userIds]);
    await api.patch(`/admin/flags/${FLAG}`, { enabled: true, targetUserIds: [...targets] });
}

async function tierOf(api: Api, id: string): Promise<number> {
    const { items } = await api.get<{ items: MyAchievement[] }>('/me/achievements');
    return items.find((i) => i.id === id)?.tier ?? 0;
}

test.describe('@achievements profile tab', () => {
    test('a ticket created after the flag turned on unlocks Reporter on the tab', async ({
        browser,
        api,
    }) => {
        test.setTimeout(PROJECTOR_TIMEOUT_MS + 60_000);

        // Arrange: a fresh user with the flag on; the first GET stamps their start of counting
        const user = await seedUser(api, 'achiever');
        await enableFor(api, [user.id]);
        const asUser = await Api.signIn(user.email, PASSWORD);
        await expect.poll(() => tierOf(asUser, 'reporter')).toBe(0);
        const projectKey = uniqueProjectKey('A');
        await asUser.createProject({ key: projectKey });
        await asUser.post(`/projects/${projectKey}/tickets`, {
            title: 'My first ticket',
            type: 'Technical',
        });

        // Act: wait for the projector to award Bronze, then open the tab
        await expect
            .poll(() => tierOf(asUser, 'reporter'), {
                timeout: PROJECTOR_TIMEOUT_MS,
                intervals: [2_000],
            })
            .toBeGreaterThanOrEqual(1);
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const achievements = new AchievementsPage(page);
        await page.goto('/profile');
        await achievements.tab.click();

        // Assert: the unlocked medal sits in Earned with its name and tier written out
        await expect(achievements.root).toBeVisible();
        await expect(achievements.privacy).toContainText('Only you can see these');
        const reporter = achievements.earned.getByTestId('achievement-tile-reporter');
        await expect(reporter).toBeVisible();
        await expect(reporter).toHaveAttribute('data-tier', '1');
        await expect(reporter).toContainText('Bronze');
        await expect(reporter).toContainText('1 of 10 to Silver');
        await expect(achievements.openButton('reporter')).toHaveAccessibleName('Reporter, Bronze');
        await expect(achievements.toEarn.getByTestId('achievement-tile-closer')).toBeVisible();

        // Assert: opening the tab marked the unlock seen
        await expect
            .poll(
                async () => (await asUser.get<{ count: number }>('/me/achievements/unseen')).count,
            )
            .toBe(0);

        // Act: the grid has one tab stop; Enter opens the detail, Escape closes it
        await achievements.openButton('reporter').focus();
        await page.keyboard.press('Enter');

        // Assert
        await expect(achievements.detail).toBeVisible();
        await expect(achievements.detail.getByRole('heading', { name: 'Reporter' })).toBeVisible();
        await expect(achievements.detail.getByRole('list', { name: 'Tiers' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(achievements.detail).toBeHidden();
        await expect(achievements.openButton('reporter')).toBeFocused();

        await asUser.dispose();
        await context.close();
    });

    test('the tab is hidden while the flag is off for the user', async ({ browser, api }) => {
        // Arrange
        const user = await seedUser(api, 'no-achievements');
        const asUser = await Api.signIn(user.email, PASSWORD);
        const { flags } = await asUser.get<{ flags: Record<string, string> }>('/me/flags');
        await asUser.dispose();
        test.skip(flags[FLAG] === 'on', 'the achievements flag is rolled out to everyone here');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const achievements = new AchievementsPage(page);

        // Act
        await page.goto('/profile');

        // Assert
        await expect(page.getByTestId('profile-tab-tokens')).toBeVisible();
        await expect(achievements.tab).toHaveCount(0);

        await context.close();
    });
});
