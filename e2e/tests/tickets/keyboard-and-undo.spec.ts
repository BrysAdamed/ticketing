import { BacklogPage } from '../../pages/backlog.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    id: string;
    key: string;
    title: string;
}

async function seed(api: Api, titles: string[]): Promise<{ projectKey: string; keys: string[] }> {
    const projectKey = (await api.createProject({ visibility: 'Public' })).key;
    const keys: string[] = [];
    for (const title of titles)
        keys.push(
            (
                await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
                    title,
                    type: 'UserStory',
                })
            ).key,
        );
    return { projectKey, keys };
}

test.describe('keyboard, optimistic edits and undo', () => {
    test('quick-create keeps up with fast typing: every title becomes its own ticket', async ({
        page,
        api,
    }) => {
        // Arrange
        const { projectKey } = await seed(api, ['Existing']);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await page.keyboard.press('c');
        await expect(backlog.quickCreateInput).toBeFocused();

        // Act: three titles typed back to back, without waiting for the server
        for (const title of ['Alpha', 'Bravo', 'Charlie']) {
            await page.keyboard.type(title);
            await page.keyboard.press('Enter');
        }

        // Assert: the input is free at once and the server has exactly these three titles
        await expect(backlog.quickCreateInput).toHaveValue('');
        await expect(backlog.quickCreateInput).toBeFocused();
        await expect
            .poll(async () => {
                const saved = await api.get<{ items: { title: string }[] }>(
                    `/projects/${projectKey}/backlog`,
                );
                return saved.items.map((i) => i.title).sort();
            })
            .toEqual(['Alpha', 'Bravo', 'Charlie', 'Existing']);
        await expect.poll(() => backlog.keys()).toHaveLength(4);
    });

    test('e focuses the title input, so typing edits the title instead of firing shortcuts', async ({
        page,
        api,
    }) => {
        // Arrange
        const { keys } = await seed(api, ['Old title']);
        const ticket = new TicketPage(page);
        await ticket.goto(keys[0]);
        await expect(ticket.title).toHaveText('Old title');

        // Act
        await page.keyboard.press('e');
        const input = ticket.root.getByTestId('title-input');
        await expect(input).toBeFocused();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('Sharper title');
        await page.keyboard.press('Enter');

        // Assert
        await expect(ticket.title).toHaveText('Sharper title');
        await expect
            .poll(async () => (await api.get<TicketSummary>(`/tickets/${keys[0]}`)).title)
            .toBe('Sharper title');
        await expect(page).toHaveTitle(`${keys[0]} Sharper title · Ticketing`);
    });

    test('shortcuts do nothing while a dialog is open', async ({ page, api }) => {
        // Arrange
        const { projectKey } = await seed(api, ['Focus me']);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await page.keyboard.press('j');
        await page.keyboard.press('?');
        await expect(page.getByRole('dialog')).toBeVisible();

        // Act
        await page.keyboard.press('Enter');
        await page.keyboard.press('c');

        // Assert
        await expect(page).not.toHaveURL(/peek=/);
        await expect(backlog.quickCreateInput).toHaveCount(0);
    });

    test('i assigns to me and Undo puts the ticket back to unassigned', async ({ page, api }) => {
        // Arrange
        const { projectKey, keys } = await seed(api, ['Mine soon']);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await expect(backlog.row(keys[0])).toBeVisible();

        // Act
        await page.keyboard.press('j');
        await page.keyboard.press('i');
        const toast = page.getByTestId('toast').filter({ hasText: 'assigned to you' });
        await expect(toast).toBeVisible();
        await expect
            .poll(
                async () => (await api.get<{ assignee: unknown }>(`/tickets/${keys[0]}`)).assignee,
            )
            .not.toBeNull();
        await toast.getByRole('button', { name: 'Undo' }).click();

        // Assert
        await expect
            .poll(
                async () => (await api.get<{ assignee: unknown }>(`/tickets/${keys[0]}`)).assignee,
            )
            .toBeNull();
    });

    test('Delete removes a ticket at once, closes its peek, and Undo restores it', async ({
        page,
        api,
    }) => {
        // Arrange
        const { projectKey, keys } = await seed(api, ['Keep', 'Remove me']);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await backlog.row(keys[1]).getByTestId('row-title').click();
        await expect(page.getByTestId('peek-panel')).toBeVisible();

        // Act
        await page.keyboard.press('Delete');

        // Assert: gone at once, peek closed, deleted on the server
        await expect(backlog.row(keys[1])).toHaveCount(0);
        await expect(page.getByTestId('peek-panel')).toHaveCount(0);
        const toast = page.getByTestId('toast').filter({ hasText: `${keys[1]} deleted` });
        await expect(toast).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // Act: undo
        await toast.getByRole('button', { name: 'Undo' }).click();

        // Assert: back in the list and on the server
        await expect(backlog.row(keys[1])).toBeVisible();
        expect((await api.get<TicketSummary>(`/tickets/${keys[1]}`)).title).toBe('Remove me');
    });

    test('peek follows j and k', async ({ page, api }) => {
        // Arrange
        const { projectKey, keys } = await seed(api, ['One', 'Two']);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await backlog.row(keys[0]).getByTestId('row-title').click();
        await expect(page).toHaveURL(new RegExp(`peek=${keys[0]}`));

        // Act
        await page.keyboard.press('j');

        // Assert
        await expect(page).toHaveURL(new RegExp(`peek=${keys[1]}`));
        await expect(new TicketPage(page, 'peek').title).toHaveText('Two');
    });
});

test.describe('project shell requests', () => {
    test('opening a project fetches it once, and an unknown key shows one not-found state', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const projectGets: string[] = [];
        page.on('request', (r) => {
            if (r.method() === 'GET' && /\/api\/v1\/projects\/[A-Z0-9]+$/.test(r.url()))
                projectGets.push(r.url());
        });

        // Act
        await page.goto(`/projects/${projectKey}/backlog`);
        await expect(page.getByTestId('view-backlog.list')).toBeVisible();
        await page.waitForTimeout(500);
        const forKnown = projectGets.length;
        projectGets.length = 0;
        await page.goto('/projects/NOPE1/backlog');
        await expect(page.getByTestId('project-not-found')).toBeVisible();
        await page.waitForTimeout(1000);

        // Assert
        expect(forKnown).toBe(1);
        expect(projectGets.length).toBe(1);
        await expect(page.getByText("Couldn't load the backlog")).toHaveCount(0);
    });
});
