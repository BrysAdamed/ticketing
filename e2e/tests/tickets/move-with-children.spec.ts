import { BacklogPage } from '../../pages/backlog.page';
import { BoardPage } from '../../pages/board.page';
import { Api } from '../../support/api';
import { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    key: string;
}

interface Backlog {
    items: { key: string }[];
}

/// An epic with two stories, each with a sub-task, plus a Done sub-task that must stay behind, all
/// in the backlog; and a board linking the project.
async function seed(api: Api) {
    const projectKey = (await api.createProject({ visibility: 'Public' })).key;
    const create = async (title: string, extra: object = {}) =>
        (
            await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
                title,
                type: 'UserStory',
                ...extra,
            })
        ).key;
    const epic = await create('Checkout', { type: 'Epic' });
    const cart = await create('Cart page', { parentKey: epic });
    const pay = await create('Pay by card', { parentKey: epic });
    const cartApi = await create('Cart API', { type: 'Technical', parentKey: cart });
    const payApi = await create('Card gateway', { type: 'Technical', parentKey: pay });
    const shipped = await create('Cart icon', {
        type: 'Technical',
        parentKey: cart,
        status: 'Done',
    });
    const boardName = `Sprint ${projectKey}`;
    const board = await api.post<{ id: string }>('/boards', {
        name: boardName,
        projectKeys: [projectKey],
    });
    return {
        projectKey,
        epic,
        children: [cart, pay, cartApi, payApi],
        shipped,
        boardId: board.id,
        boardName,
    };
}

async function backlogKeys(api: Api, projectKey: string): Promise<string[]> {
    return (await api.get<Backlog>(`/projects/${projectKey}/backlog`)).items.map((i) => i.key);
}

async function moveEpicToBoard(page: Page, epic: string, boardName: string): Promise<void> {
    const backlog = new BacklogPage(page);
    await backlog.row(epic).getByTestId('row-checkbox').click();
    await page.getByTestId('bulk-move').click();
    await page.getByTestId('inline-picker').getByRole('option', { name: boardName }).click();
}

test.describe('move with sub-tickets', () => {
    test('moving an epic from the backlog to a board takes its open sub-tickets along, right after it', async ({
        page,
        api,
    }) => {
        // Arrange
        const s = await seed(api);
        const order = await backlogKeys(api, s.projectKey);
        const expectedChildren = order.filter((key) => s.children.includes(key));
        const backlog = new BacklogPage(page);
        await backlog.goto(s.projectKey);

        // Act
        await moveEpicToBoard(page, s.epic, s.boardName);
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText(
            `${s.epic} has 4 sub-tickets in the backlog. Move them to ${s.boardName} too?`,
        );
        await expect(dialog.getByTestId('confirm-detail')).toHaveText('1 is Done');
        await expect(dialog.getByRole('button', { name: 'Move with sub-tickets' })).toBeFocused();
        await dialog.getByRole('button', { name: 'Move with sub-tickets' }).click();

        // Assert
        await expect(backlog.row(s.epic)).toBeHidden();
        for (const key of s.children) await expect(backlog.row(key)).toBeHidden();
        const board = new BoardPage(page);
        await board.goto(s.boardId);
        await expect.poll(() => board.keys('ToDo')).toEqual([s.epic, ...expectedChildren]);
        const left = await backlogKeys(api, s.projectKey);
        expect(left).not.toContain(s.epic);
        for (const key of s.children) expect(left).not.toContain(key);
        await expect(board.card(s.shipped)).toBeHidden();
    });

    test('"Only the selected tickets" leaves the sub-tickets in the backlog', async ({
        page,
        api,
    }) => {
        // Arrange
        const s = await seed(api);
        const backlog = new BacklogPage(page);
        await backlog.goto(s.projectKey);

        // Act
        await moveEpicToBoard(page, s.epic, s.boardName);
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('button', { name: 'Only the selected tickets' }).click();

        // Assert
        await expect(backlog.row(s.epic)).toBeHidden();
        for (const key of s.children) await expect(backlog.row(key)).toBeVisible();
        const board = new BoardPage(page);
        await board.goto(s.boardId);
        await expect.poll(() => board.keys('ToDo')).toEqual([s.epic]);
        const left = await backlogKeys(api, s.projectKey);
        for (const key of s.children) expect(left).toContain(key);
    });
});
