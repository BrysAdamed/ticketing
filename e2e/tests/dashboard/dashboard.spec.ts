import { DashboardPage } from '../../pages/dashboard.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface TicketSeed {
    title: string;
    type: string;
    status?: string;
    severity?: string;
    storyPoints?: number;
    version?: string;
}

async function seed(api: Api, tickets: TicketSeed[]): Promise<string> {
    const { key } = await api.createProject();
    for (const ticket of tickets) await api.post(`/projects/${key}/tickets`, ticket);
    return key;
}

function searchParams(url: string): Record<string, string> {
    return Object.fromEntries(new URL(url).searchParams.entries());
}

test.describe('project dashboard', () => {
    test('numbers match the seeded tickets and every count opens its search', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = await seed(api, [
            { title: 'Saved cards', type: 'UserStory', storyPoints: 3 },
            { title: 'Wallet page', type: 'UserStory', storyPoints: 5 },
            { title: 'Retry payouts', type: 'Technical' },
            {
                title: 'Card declined twice',
                type: 'Bug',
                status: 'InProgress',
                severity: 'Critical',
            },
            { title: 'Wrong currency symbol', type: 'Bug', status: 'InProgress' },
            { title: 'Refund flow', type: 'UserStory', status: 'Review', storyPoints: 8 },
            { title: 'Receipt email', type: 'UserStory', status: 'Done', version: '1.0' },
            { title: 'Invoice PDF', type: 'Technical', status: 'Done' },
        ]);
        const dashboard = new DashboardPage(page);

        // Act
        await dashboard.goto(projectKey);

        // Assert: widget numbers
        await expect(dashboard.kpiValue('open')).toHaveText('6');
        await expect(dashboard.kpiValue('done')).toHaveText('2');
        await expect(dashboard.kpiValue('points')).toHaveText('16');
        await expect(dashboard.kpiValue('unassigned')).toHaveText('6');
        await expect(dashboard.count('status-', 'ToDo')).toHaveText('3');
        await expect(dashboard.count('status-', 'InProgress')).toHaveText('2');
        await expect(dashboard.count('status-', 'Testing')).toHaveText('0');
        await expect(dashboard.count('type-', 'Bug')).toHaveText('2');
        await expect(dashboard.count('severity-', 'Critical')).toHaveText('1');
        await expect(dashboard.count('severity-', 'none')).toHaveText('1');

        // Act: a status count opens the search that produces it
        await dashboard.count('status-', 'InProgress').click();

        // Assert
        await expect(page).toHaveURL(/\/search\?/);
        expect(searchParams(page.url())).toEqual({ project: projectKey, status: 'InProgress' });

        // Act: a KPI tile does the same
        await dashboard.goto(projectKey);
        await dashboard.kpi('unassigned').click();

        // Assert
        await expect(page).toHaveURL(/\/search\?/);
        expect(searchParams(page.url())).toEqual({
            project: projectKey,
            category: 'ToDo,InProgress',
            assignee: 'unassigned',
        });
    });

    test('the version filter narrows ticket widgets, lives in the URL and carries into search links', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = await seed(api, [
            { title: 'Checkout redesign', type: 'UserStory', version: '2.0' },
            { title: 'Apple Pay', type: 'UserStory', status: 'Done', version: '2.0' },
            { title: 'Legacy cleanup', type: 'Technical', version: '1.9' },
        ]);
        const dashboard = new DashboardPage(page);
        await dashboard.goto(projectKey);
        await expect(dashboard.kpiValue('open')).toHaveText('2');

        // Act
        await dashboard.pickVersion('2.0');

        // Assert
        await expect(page).toHaveURL(/version=2\.0/);
        await expect(dashboard.kpiValue('open')).toHaveText('1');
        await expect(dashboard.kpiValue('done')).toHaveText('1');

        // Act
        await dashboard.kpi('done').click();

        // Assert
        await expect(page).toHaveURL(/\/search\?/);
        expect(searchParams(page.url())).toEqual({
            project: projectKey,
            category: 'Done',
            version: '2.0',
        });
    });
});
