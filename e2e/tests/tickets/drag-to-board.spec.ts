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
    const login = await create('Login form');
    const signup = await create('Signup form');
    const boardName = `Sprint ${projectKey}`;
    const board = await api.post<{ id: string }>('/boards', {
        name: boardName,
        projectKeys: [projectKey],
    });
    return { projectKey, epic, children: [cart, pay], login, signup, boardId: board.id, boardName };
}

async function backlogKeys(api: Api, projectKey: string): Promise<string[]> {
    return (await api.get<Backlog>(`/projects/${projectKey}/backlog`)).items.map((i) => i.key);
}

function moveResponse(page: Page) {
    return page.waitForResponse(
        (r) => r.url().endsWith('/api/v1/tickets/move') && r.request().method() === 'POST',
    );
}

test.describe('drag onto the "On boards" panel', () => {
    test('dragging an epic onto a board and choosing "Move with sub-tickets" moves it with its sub-tickets', async ({
        page,
        api,
    }) => {
        // Arrange
        const s = await seed(api);
        const backlog = new BacklogPage(page);
        await backlog.goto(s.projectKey);
        await expect(backlog.boardTarget(s.boardName)).toBeVisible();

        // Act
        await backlog.dragToBoard(s.epic, s.boardName);
        const dialog = page.locator('tk-confirm-dialog');
        await expect(dialog).toContainText(
            `${s.epic} has 2 sub-tickets in the backlog. Move them to ${s.boardName} too?`,
        );
        const moved = moveResponse(page);
        await dialog.getByRole('button', { name: 'Move with sub-tickets' }).click();
        expect((await moved).ok()).toBe(true);

        // Assert
        await expect(backlog.row(s.epic)).toBeHidden();
        for (const key of s.children) await expect(backlog.row(key)).toBeHidden();
        await expect(page.getByTestId('on-boards-count')).toContainText('3 more tickets on boards');
        const left = await backlogKeys(api, s.projectKey);
        expect(left).toEqual([s.login, s.signup]);
        const board = new BoardPage(page);
        await board.goto(s.boardId);
        await expect.poll(() => board.keys('ToDo')).toEqual([s.epic, ...s.children]);
    });

    test('dragging a selected row moves the whole selection; the other rows stay', async ({
        page,
        api,
    }) => {
        // Arrange
        const s = await seed(api);
        const backlog = new BacklogPage(page);
        await backlog.goto(s.projectKey);
        await backlog.row(s.login).getByTestId('row-checkbox').click();
        await backlog.row(s.signup).getByTestId('row-checkbox').click();
        await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');

        // Act
        const moved = moveResponse(page);
        await backlog.dragToBoard(s.signup, s.boardName);
        expect((await moved).ok()).toBe(true);

        // Assert
        await expect(backlog.row(s.login)).toBeHidden();
        await expect(backlog.row(s.signup)).toBeHidden();
        await expect(backlog.row(s.epic)).toBeVisible();
        await expect(page.getByTestId('bulk-bar')).toBeHidden();
        const left = await backlogKeys(api, s.projectKey);
        expect(left).toEqual([s.epic, ...s.children]);
    });

    test('a board in the panel moves the selection from the keyboard', async ({ page, api }) => {
        // Arrange
        const s = await seed(api);
        const backlog = new BacklogPage(page);
        await backlog.goto(s.projectKey);
        const target = backlog.boardTarget(s.boardName);
        await expect(target).toHaveAttribute('aria-disabled', 'true');
        await backlog.row(s.login).getByTestId('row-checkbox').click();
        await expect(target).toHaveAccessibleName(`Move 1 selected ticket to ${s.boardName}`);

        // Act
        await target.focus();
        const moved = moveResponse(page);
        await page.keyboard.press('Enter');
        expect((await moved).ok()).toBe(true);

        // Assert
        await expect(backlog.row(s.login)).toBeHidden();
        expect(await backlogKeys(api, s.projectKey)).not.toContain(s.login);
    });
});
