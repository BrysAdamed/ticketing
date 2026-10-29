import { AchievementsPage } from '../../pages/achievements.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';
import { ACHIEVEMENTS_FLAG as FLAG, enableAchievementsFor as enableFor } from './achievements';

async function hidden(api: Api): Promise<boolean> {
    return (await api.get<{ achievementsHidden: boolean }>('/me')).achievementsHidden;
}

test.describe('@achievements opt-out', () => {
    test('turning achievements off asks first, hides the tab, and turning them on brings it back', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'opt-out');
        await enableFor(api, [user.id]);
        const asUser = await Api.signIn(user.email, PASSWORD);
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const achievements = new AchievementsPage(page);
        const card = page.getByTestId('profile-achievements-card');
        const toggle = card.getByRole('switch', { name: 'Earn achievements' });
        const confirm = card.getByTestId('profile-achievements-confirm');
        await page.goto('/profile');

        // Assert: on by default, private unless shared
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(card).toContainText('unless you share one');
        await expect(achievements.tab).toBeVisible();

        // Act: "Keep them" leaves everything as it was
        await toggle.click();
        await expect(confirm).toContainText('Turn off and delete your achievements?');
        await confirm.getByRole('button', { name: 'Keep them' }).click();

        // Assert
        await expect(confirm).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        expect(await hidden(asUser)).toBe(false);

        // Act: confirm the opt-out
        await toggle.click();
        await confirm.getByRole('button', { name: 'Turn off and delete' }).click();

        // Assert: off, the tab is gone, and the server has the opt-out
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await expect(achievements.tab).toHaveCount(0);
        await expect.poll(() => hidden(asUser)).toBe(true);

        // Act: turning back on needs no confirm
        await toggle.click();

        // Assert
        await expect(confirm).toBeHidden();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(achievements.tab).toBeVisible();
        await expect.poll(() => hidden(asUser)).toBe(false);

        await asUser.dispose();
        await context.close();
    });

    test('the opt-out card is hidden while the flag is off for the user', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'no-opt-out');
        const asUser = await Api.signIn(user.email, PASSWORD);
        const { flags } = await asUser.get<{ flags: Record<string, string> }>('/me/flags');
        await asUser.dispose();
        test.skip(flags[FLAG] === 'on', 'the achievements flag is rolled out to everyone here');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });

        // Act
        await page.goto('/profile');

        // Assert
        await expect(page.getByTestId('profile-email')).toBeVisible();
        await expect(page.getByTestId('profile-achievements-card')).toHaveCount(0);

        await context.close();
    });
});
