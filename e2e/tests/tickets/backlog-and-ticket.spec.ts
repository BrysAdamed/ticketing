import { BacklogPage } from '../../pages/backlog.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { seedUser } from '../identity/identity';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    id: string;
    key: string;
    title: string;
}

interface Ticket extends TicketSummary {
    status: string;
    priority: string;
    parent: { key: string } | null;
    commentCount: number | null;
}

async function seedProject(api: Api): Promise<string> {
    return (await api.createProject({ visibility: 'Public' })).key;
}

function createTicket(
    api: Api,
    projectKey: string,
    title: string,
    type = 'UserStory',
    extra: object = {},
): Promise<TicketSummary> {
    return api.post<TicketSummary>(`/projects/${projectKey}/tickets`, { title, type, ...extra });
}

test.describe('backlog and ticket view', () => {
    test('quick-create, edit inline, comment and set a parent', async ({ page, api }) => {
        // Arrange
        const projectKey = await seedProject(api);
        const epic = await createTicket(api, projectKey, 'Checkout revamp', 'Epic');
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await expect(backlog.row(epic.key)).toBeVisible();

        // Act: quick-create
        await backlog.quickCreate('Show saved cards in the wallet');
        const key = `${projectKey}-2`;
        await expect(backlog.row(key)).toBeVisible();
        await page.keyboard.press('Escape');

        // Act: inline edits in the row
        await backlog.pick(key, 'priority', 'High');
        await backlog.pick(key, 'status', 'In Progress');
        await expect(backlog.row(key).getByTestId('row-status')).toHaveAttribute(
            'aria-label',
            'Status: In Progress',
        );

        // Act: open in the peek panel, rename, comment, set the parent
        await backlog.row(key).getByTestId('row-title').click();
        await expect(page).toHaveURL(new RegExp(`peek=${key}`));
        const ticket = new TicketPage(page, 'peek');
        await expect(ticket.title).toHaveText('Show saved cards in the wallet');
        await ticket.rename('Show saved cards in the checkout wallet');
        await ticket.comment('Designs are ready, see ' + epic.key);
        await expect(ticket.activity.getByText('Designs are ready')).toBeVisible();
        await ticket.setParent(epic.key, `${epic.key} Checkout revamp`);
        await expect(ticket.field('parent')).toContainText(epic.key);

        // Assert: the server has every change, and the backlog row shows the parent chip
        await expect
            .poll(async () => {
                const saved = await api.get<Ticket>(`/tickets/${key}`);
                return [
                    saved.title,
                    saved.priority,
                    saved.status,
                    saved.parent?.key,
                    saved.commentCount,
                ];
            })
            .toEqual([
                'Show saved cards in the checkout wallet',
                'High',
                'InProgress',
                epic.key,
                1,
            ]);
        await expect(backlog.row(key)).toContainText('Checkout revamp');
    });

    test('reorder the backlog by drag and drop', async ({ page, api }) => {
        // Arrange
        const projectKey = await seedProject(api);
        for (const title of ['First', 'Second', 'Third', 'Fourth'])
            await createTicket(api, projectKey, title);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await expect(backlog.row(`${projectKey}-4`)).toBeVisible();

        // Act
        const ranked = page.waitForResponse(
            (r) => r.url().includes('/tickets/move') && r.request().method() === 'POST',
        );
        await backlog.dragBefore(`${projectKey}-4`, `${projectKey}-2`);

        // Assert: optimistic order, then the server order after a reload
        const expected = [1, 4, 2, 3].map((n) => `${projectKey}-${n}`);
        await expect.poll(() => backlog.keys()).toEqual(expected);
        expect((await ranked).status()).toBe(200);
        await page.reload();
        await expect(backlog.row(`${projectKey}-1`)).toBeVisible();
        await expect.poll(() => backlog.keys()).toEqual(expected);
    });

    test('setting status Done hides the ticket unless show done is on', async ({ page, api }) => {
        // Arrange
        const projectKey = await seedProject(api);
        const ticket = await createTicket(api, projectKey, 'Ship it');
        await createTicket(api, projectKey, 'Keep me');
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await expect(backlog.row(ticket.key)).toBeVisible();

        // Act
        await backlog.pick(ticket.key, 'status', 'Done');

        // Assert
        await expect(backlog.row(ticket.key)).toBeHidden();
        await expect(backlog.count).toHaveText('1');
        await backlog.showDone.click();
        await expect(backlog.row(ticket.key)).toBeVisible();
        const saved = await api.get<Ticket>(`/tickets/${ticket.key}`);
        expect(saved.status).toBe('Done');
    });

    test('full page ticket view shows a deleted ticket as deleted', async ({ page, api }) => {
        // Arrange
        const projectKey = await seedProject(api);
        const ticket = await createTicket(api, projectKey, 'Short-lived');
        await api.delete(`/tickets/${ticket.key}`);

        // Act
        await page.goto(`/tickets/${ticket.key}`);

        // Assert
        await expect(page.getByText(`${ticket.key} was deleted by`)).toBeVisible();
    });

    test('s and a open pickers for the focused row; the assignee picker offers any active user', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = await seedProject(api);
        const ticket = await createTicket(api, projectKey, 'Keyboard first');
        const outsider = await seedUser(api, `kbd${Date.now().toString(36)}`);
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await expect(backlog.row(ticket.key)).toBeVisible();

        // Act: status through s
        await page.keyboard.press('j');
        await page.keyboard.press('s');
        await page
            .getByTestId('inline-picker')
            .getByRole('option', { name: /^Review/ })
            .click();

        // Act: assignee through a, searching a user who is not a project member
        await page.keyboard.press('a');
        const search = page.getByTestId('search-picker');
        await search.getByTestId('search-picker-input').fill(outsider.displayName);
        await search.getByRole('option', { name: outsider.displayName }).click();

        // Assert
        await expect(backlog.row(ticket.key).getByTestId('row-status')).toHaveAttribute(
            'aria-label',
            'Status: Review',
        );
        await expect
            .poll(
                async () =>
                    (await api.get<{ assignee: { id: string } | null }>(`/tickets/${ticket.key}`))
                        .assignee?.id,
            )
            .toBe(outsider.id);
    });

    test('the current group header stays pinned while the backlog scrolls', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = await seedProject(api);
        await api.post(`/projects/${projectKey}/tickets/batch`, {
            tickets: Array.from({ length: 40 }, (_, i) => ({
                title: `Ticket ${i + 1}`,
                type: 'UserStory',
            })),
        });
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await expect(backlog.row(`${projectKey}-1`)).toBeVisible();
        await expect(page.getByTestId('sticky-group')).toHaveCount(0);

        // Act
        await page.getByTestId('backlog-list').evaluate((list) => list.scrollTo({ top: 400 }));

        // Assert
        await expect(page.getByTestId('sticky-group')).toContainText('To Do');
    });
});
