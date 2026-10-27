import { expect, Locator, Page } from '@playwright/test';

/// The boards list (`/boards`) and one board (`/boards/:id`): columns, cards, quick filters, dialogs.
export class BoardPage {
    readonly listView: Locator;
    readonly view: Locator;
    readonly name: Locator;

    constructor(private readonly page: Page) {
        this.listView = page.getByTestId('view-boards.list');
        this.view = page.getByTestId('view-board.kanban');
        this.name = page.getByTestId('board-name');
    }

    async gotoList(): Promise<void> {
        await this.page.goto('/boards');
        await expect(this.listView).toBeVisible();
    }

    async goto(boardId: string): Promise<void> {
        await this.page.goto(`/boards/${boardId}`);
        await expect(this.name).toBeVisible();
    }

    async createBoard(name: string, projectKeys: string[]): Promise<void> {
        await this.page.getByTestId('boards-new').click();
        const dialog = this.page.getByTestId('create-board-dialog');
        await dialog.getByTestId('create-board-name').fill(name);
        for (const key of projectKeys)
            await dialog.getByTestId(`create-board-project-${key}`).click();
        await dialog.getByTestId('create-board-submit').click();
        await expect(this.name).toHaveText(name);
    }

    card(key: string): Locator {
        return this.page.getByTestId(`board-card-${key}`);
    }

    cell(status: string): Locator {
        return this.page.getByTestId(`board-cell-${status}`);
    }

    /// Card keys of a column (no swimlanes), top to bottom.
    async keys(status: string): Promise<string[]> {
        const ids = await this.cell(status)
            .locator('tk-board-card')
            .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-testid') ?? ''));
        return ids.map((id) => id.replace('board-card-', ''));
    }

    async addFromBacklog(projectKey: string, keys: string[]): Promise<void> {
        await this.page.getByTestId('board-add-tickets').click();
        const dialog = this.page.getByTestId('add-tickets-dialog');
        await expect(dialog.getByTestId('add-tickets-search')).toBeVisible();
        const tab = dialog.getByTestId(`add-tickets-project-${projectKey}`);
        if (await tab.count()) {
            await tab.click();
            await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
        for (const key of keys) await dialog.getByTestId(`add-tickets-row-${key}`).click();
        await dialog.getByTestId('add-tickets-submit').click();
        await expect(this.page.getByTestId('add-tickets-dialog')).toHaveCount(0);
    }

    /// Drags a card into another column's empty space (bottom of the column), with a CDK-friendly mouse path.
    async dragToColumn(key: string, status: string): Promise<void> {
        const column = this.cell(status);
        await column.scrollIntoViewIfNeeded();
        const source = await this.card(key).boundingBox();
        const target = await column.boundingBox();
        if (!source || !target) throw new Error('Card or column is not visible.');
        await this.page.mouse.move(source.x + source.width / 2, source.y + 20);
        await this.page.mouse.down();
        await this.page.mouse.move(source.x + source.width / 2 + 10, source.y + 30, { steps: 4 });
        await this.page.mouse.move(target.x + target.width / 2, target.y + target.height - 24, {
            steps: 40,
        });
        await this.page.mouse.move(target.x + target.width / 2, target.y + target.height - 20, {
            steps: 2,
        });
        await expect(column).toHaveClass(/cdk-drop-list-dragging/);
        await this.page.mouse.up();
    }

    async archive(carryOver: 'backlog' | 'board'): Promise<void> {
        await this.page.getByTestId('board-settings').click();
        await this.page
            .getByTestId('board-settings-dialog')
            .getByTestId('settings-archive')
            .click();
        const dialog = this.page.getByTestId('archive-board-dialog');
        await dialog.getByTestId(`carry-over-${carryOver}`).click();
        await dialog.getByTestId('archive-submit').click();
        await expect(this.page.getByTestId('board-archived')).toBeVisible();
    }
}
