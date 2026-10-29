import { CONNECT_AGENT_URL } from '@onboarding/agent/connect-agent';
import { AchievementsPage } from '../../pages/achievements.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

const FLAG = 'achievements';

interface Flag {
    key: string;
    targetUsers: { id: string }[];
}

interface MyAchievement {
    id: string | null;
    masked: boolean;
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

test.describe('@achievements how to earn', () => {
    test('a locked medal shows how to earn it and Show me starts its learn action', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'learner');
        await enableFor(api, [user.id]);
        const asUser = await Api.signIn(user.email, PASSWORD);
        const { items } = await asUser.get<{ items: MyAchievement[] }>('/me/achievements');
        await asUser.dispose();
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
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
