import { CONNECT_AGENT_URL } from '@onboarding/agent/connect-agent';
import { AchievementsPage } from '../../pages/achievements.page';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';
import { enableAchievementsFor as enableFor } from './achievements';

interface MyAchievement {
    id: string | null;
    masked: boolean;
}

test.describe('@achievements how to earn', () => {
    test('a locked medal shows how to earn it and Show me starts its learn action', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'learner');
        await enableFor(api, [user.id]);
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const response = await context.request.get('/api/v1/me/achievements');
        expect(response.ok()).toBe(true);
        const { items } = (await response.json()) as { items: MyAchievement[] };
        const achievements = new AchievementsPage(page);
        await achievements.goto();

        // Act
        await achievements.openButton('machine-whisperer').click();

        // Assert
        await expect(achievements.detail).toBeVisible();
        await expect(achievements.detail.getByTestId('achievement-how-to-earn')).toContainText(
            'Connect an AI agent over MCP',
        );
        await expect(achievements.detail.getByTestId('achievement-learn')).toContainText(
            'Opens the Connect an AI agent guide.',
        );

        // Act
        await achievements.detail.getByTestId('achievement-show-me').click();

        // Assert
        await expect(achievements.detail).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`${CONNECT_AGENT_URL.replace('?', '\\?')}$`));
        await expect(page.getByTestId('connect-agent-guide')).toBeVisible();

        // Act: a masked secret gets neither a hint nor Show me
        const secretIndex = items.findIndex((i) => i.masked);
        test.skip(secretIndex < 0, 'no masked secret in the catalogue');
        await achievements.goto();
        await achievements.openButton(`secret-${secretIndex}`).click();

        // Assert
        await expect(achievements.detail).toContainText('there is no hint');
        await expect(achievements.detail.getByTestId('achievement-how-to-earn')).toHaveCount(0);
        await expect(achievements.detail.getByTestId('achievement-show-me')).toHaveCount(0);

        await context.close();
    });
});
