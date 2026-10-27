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

    test('recent docs list the latest pages and diagrams and open them', async ({ page, api }) => {
        // Arrange
        const projectKey = await seed(api, [{ title: 'Checkout redesign', type: 'UserStory' }]);
        const folder = await api.post<{ key: string }>(`/projects/${projectKey}/docs`, {
            kind: 'Folder',
            title: 'Guides',
        });
        await api.post(`/projects/${projectKey}/docs`, {
            kind: 'Page',
            title: 'Old notes',
            content: 'Old',
        });
        const flow = await api.post<{ key: string }>(`/projects/${projectKey}/docs`, {
            kind: 'Diagram',
            diagramFormat: 'Mermaid',
            title: 'Checkout flow',
            parent: folder.key,
            content: 'flowchart LR\n  a --> b',
        });
        const dashboard = new DashboardPage(page);

        // Act
        await dashboard.goto(projectKey);
        const card = page.getByTestId('dashboard-recent-docs');
        await card.scrollIntoViewIfNeeded();

        // Assert
        await expect(page.getByTestId('recent-docs-count')).toHaveText('2 docs');
        const first = page.getByTestId(`dashboard-doc-${flow.key}`);
        await expect(first).toContainText('Checkout flow');
        await expect(first).toContainText('Guides');

        // Act
        await first.click();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/projects/${projectKey}/docs/${flow.key}/`));
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
