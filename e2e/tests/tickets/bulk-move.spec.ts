import { BacklogPage } from '../../pages/backlog.page';
import { BoardPage } from '../../pages/board.page';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    key: string;
}

interface Backlog {
    items: { key: string }[];
}

test.describe('bulk move to board', () => {
    test('after deselecting a row, "Move to board" moves the selected rows, not the deselected one', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const keys: string[] = [];
        for (const title of ['Login form', 'Signup form', 'Reset password']) {
            keys.push(
                (
                    await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
                        title,
                        type: 'UserStory',
                    })
                ).key,
            );
        }
        const [first, deselected, third] = keys;
        const boardName = `Sprint ${projectKey}`;
        const board = await api.post<{ id: string }>('/boards', {
            name: boardName,
            projectKeys: [projectKey],
        });
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);

        // Act
        for (const key of keys) await backlog.row(key).getByTestId('row-checkbox').click();
        await backlog.row(deselected).getByTestId('row-checkbox').click();
        await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
        const moved = page.waitForResponse(
            (r) => r.url().endsWith('/api/v1/tickets/move') && r.request().method() === 'POST',
        );
        await page.getByTestId('bulk-move').click();
        await page.getByTestId('inline-picker').getByRole('option', { name: boardName }).click();
        expect((await moved).ok()).toBe(true);

        // Assert
        await expect(backlog.row(first)).toBeHidden();
        await expect(backlog.row(third)).toBeHidden();
        await expect(backlog.row(deselected)).toBeVisible();
        const left = (await api.get<Backlog>(`/projects/${projectKey}/backlog`)).items.map(
            (i) => i.key,
        );
        expect(left).toEqual([deselected]);
        const boardPage = new BoardPage(page);
        await boardPage.goto(board.id);
        await expect.poll(() => boardPage.keys('ToDo')).toEqual([first, third]);
    });
});
