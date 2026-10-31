import { BacklogPage } from '../../pages/backlog.page';
import { BoardPage } from '../../pages/board.page';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    key: string;
}

test.describe('opening a ticket keeps the selection', () => {
    test('backlog: a plain click on a row opens the peek and leaves the checked rows selected', async ({
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
        const [first, second, other] = keys;
        const backlog = new BacklogPage(page);
        await backlog.goto(projectKey);
        await backlog.row(first).getByTestId('row-checkbox').click();
        await backlog.row(second).getByTestId('row-checkbox').click();
        await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');

        // Act
        await backlog.row(other).getByTestId('row-title').click();
        await expect(page).toHaveURL(new RegExp(`peek=${other}`));
        await backlog.row(first).getByTestId('row-title').click();
        await expect(page).toHaveURL(new RegExp(`peek=${first}`));

        // Assert
        await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
        await expect(backlog.row(first).getByTestId('row-checkbox')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        await expect(backlog.row(second).getByTestId('row-checkbox')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        await expect(backlog.row(other).getByTestId('row-checkbox')).toHaveAttribute(
            'aria-pressed',
            'false',
        );
    });

    test('board: a plain click on a card opens the peek and leaves the selected cards selected', async ({
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
        const [first, second, other] = keys;
        const created = await api.post<{ id: string }>('/boards', {
            name: `Sprint ${projectKey}`,
            projectKeys: [projectKey],
        });
        await api.post('/tickets/move', { keys, target: created.id });
        const board = new BoardPage(page);
        await board.goto(created.id);
        await board.card(first).click({ modifiers: ['Control'] });
        await board.card(second).click({ modifiers: ['Control'] });
        await expect(page.getByTestId('board-bulk')).toContainText('2 selected');

        // Act
        await board.card(other).click();
        await expect(page).toHaveURL(new RegExp(`peek=${other}`));

        // Assert
        await expect(page.getByTestId('board-bulk')).toContainText('2 selected');
    });
});
