import { BoardPage } from '../../pages/board.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    id: string;
    key: string;
    status: string;
    location: { kind: 'Backlog' | 'Board'; boardId: string | null };
}

interface Backlog {
    items: { key: string }[];
}

function createTicket(
    api: Api,
    projectKey: string,
    title: string,
    extra: object = {},
): Promise<TicketSummary> {
    return api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
        title,
        type: 'UserStory',
        ...extra,
    });
}

test.describe('boards', () => {
    test('create a board, add tickets from backlogs, drag across columns, filter mine, archive with carry-over', async ({
        page,
        api,
    }) => {
        // Arrange
        const web = (await api.createProject({ visibility: 'Public' })).key;
        const app = (await api.createProject({ visibility: 'Public' })).key;
        const login = await createTicket(api, web, 'Login form', { assignee: 'me' });
        const signup = await createTicket(api, web, 'Signup form');
        const done = await createTicket(api, web, 'Already shipped', { status: 'Done' });
        const push = await createTicket(api, app, 'Push notifications');
        const board = new BoardPage(page);
        const name = `Sprint ${web}`;

        // Act: create the board through the UI
        await board.gotoList();
        await board.createBoard(name, [web, app]);
        const boardId = new URL(page.url()).pathname.split('/').pop()!;
        await expect(page.getByTestId(`board-project-${web}`)).toBeVisible();
        await expect(page.getByTestId(`board-project-${app}`)).toBeVisible();

        // Act: add tickets from both backlogs
        await board.addFromBacklog(web, [login.key, signup.key]);
        await board.addFromBacklog(app, [push.key]);
        await expect.poll(() => board.keys('ToDo')).toEqual([login.key, signup.key, push.key]);
        await api.post('/tickets/move', { keys: [done.key], target: boardId });
        await page.reload();
        await expect(board.card(done.key)).toBeVisible();

        // Act: drag a card into another column, which changes its status
        await board.dragToColumn(signup.key, 'Review');
        await expect.poll(() => board.keys('Review')).toEqual([signup.key]);
        await expect
            .poll(async () => (await api.get<{ status: string }>(`/tickets/${signup.key}`)).status)
            .toBe('Review');

        // Act: quick filter "only mine", kept in the URL
        await page.getByTestId('filter-mine').click();
        await expect(page).toHaveURL(/mine=1/);
        await expect(board.card(login.key)).toBeVisible();
        await expect(board.card(signup.key)).toBeHidden();
        await expect(board.card(push.key)).toBeHidden();
        await page.getByTestId('filter-mine').click();
        await expect(board.card(push.key)).toBeVisible();

        // Act: archive, carrying unfinished tickets over to their backlogs
        await board.archive('backlog');

        // Assert: Done stays on the archived board, the rest is back at the top of each backlog
        await expect(board.card(done.key)).toBeVisible();
        await expect(board.card(login.key)).toBeHidden();
        const webBacklog = await api.get<Backlog>(`/projects/${web}/backlog`);
        expect(webBacklog.items.slice(0, 2).map((i) => i.key)).toEqual([login.key, signup.key]);
        const appBacklog = await api.get<Backlog>(`/projects/${app}/backlog`);
        expect(appBacklog.items.map((i) => i.key)).toEqual([push.key]);
        const shipped = await api.get<TicketSummary>(`/tickets/${done.key}`);
        expect(shipped.location.boardId).toBe(boardId);
    });

    test('dragging one card of a multi-selection moves the whole selection in board order', async ({
        page,
        api,
    }) => {
        // Arrange
        const key = (await api.createProject({ visibility: 'Public' })).key;
        const created = await api.post<{ id: string }>('/boards', {
            name: `Multi ${key}`,
            projectKeys: [key],
        });
        const tickets: TicketSummary[] = [];
        for (const title of ['One', 'Two', 'Three'])
            tickets.push(await createTicket(api, key, title));
        await api.post('/tickets/move', { keys: tickets.map((t) => t.key), target: created.id });
        const board = new BoardPage(page);
        await board.goto(created.id);

        // Act
        await board.card(tickets[0].key).click({ modifiers: ['Control'] });
        await board.card(tickets[2].key).click({ modifiers: ['Control'] });
        await expect(page.getByTestId('board-bulk')).toContainText('2 selected');
        await board.dragToColumn(tickets[2].key, 'Review');

        // Assert
        await expect.poll(() => board.keys('Review')).toEqual([tickets[0].key, tickets[2].key]);
        await expect
            .poll(
                async () =>
                    (await api.get<{ status: string }>(`/tickets/${tickets[0].key}`)).status,
            )
            .toBe('Review');
        expect(await board.keys('ToDo')).toEqual([tickets[1].key]);
    });

    test('a board link appears in the sidebar after visiting it', async ({ page, api }) => {
        // Arrange
        const key = (await api.createProject({ visibility: 'Public' })).key;
        const created = await api.post<{ id: string; name: string }>('/boards', {
            name: `Visit ${key}`,
            projectKeys: [key],
        });
        const board = new BoardPage(page);

        // Act
        await board.goto(created.id);

        // Assert
        await expect(page.getByTestId(`nav-board-${created.id}`)).toContainText(`Visit ${key}`);
    });

    test('a parent card shows sub-ticket progress and p changes the focused card priority', async ({
        page,
        api,
    }) => {
        // Arrange
        const key = (await api.createProject({ visibility: 'Public' })).key;
        const created = await api.post<{ id: string }>('/boards', {
            name: `Progress ${key}`,
            projectKeys: [key],
        });
        const epic = await createTicket(api, key, 'Payments', { type: 'Epic' });
        await createTicket(api, key, 'Card form', { parentKey: epic.key, status: 'Done' });
        await createTicket(api, key, 'Refunds', { parentKey: epic.key });
        await api.post('/tickets/move', { keys: [epic.key], target: created.id });
        const board = new BoardPage(page);

        // Act
        await board.goto(created.id);
        await expect(board.card(epic.key)).toBeVisible();
        await page.keyboard.press('j');
        await page.keyboard.press('p');
        await page
            .getByTestId('inline-picker')
            .getByRole('option', { name: /^Highest/ })
            .click();

        // Assert
        await expect(board.card(epic.key).getByTestId('card-progress')).toHaveText('1/2');
        await expect
            .poll(
                async () => (await api.get<{ priority: string }>(`/tickets/${epic.key}`)).priority,
            )
            .toBe('Highest');
    });
});
