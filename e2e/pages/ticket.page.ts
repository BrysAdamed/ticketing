import { expect, Locator, Page } from '@playwright/test';

/// The ticket view, either the full page (`/tickets/:key`) or the peek panel (`?peek=KEY`).
export class TicketPage {
    readonly root: Locator;
    readonly title: Locator;
    readonly composer: Locator;
    readonly activity: Locator;
    readonly watchToggle: Locator;
    readonly watchersCount: Locator;

    constructor(
        private readonly page: Page,
        scope: 'page' | 'peek' = 'page',
    ) {
        this.root =
            scope === 'peek'
                ? page.getByTestId('peek-panel').getByTestId('view-ticket.detail')
                : page.locator('[data-testid="view-ticket.detail"][data-presentation="page"]');
        this.title = this.root.getByTestId('ticket-title');
        this.composer = this.root.getByTestId('comment-composer').getByRole('textbox');
        this.activity = this.root.getByTestId('activity-feed');
        this.watchToggle = this.root.getByTestId('ticket-watch-toggle');
        this.watchersCount = this.root.getByTestId('ticket-watchers-count');
    }

    async goto(key: string): Promise<void> {
        await this.page.goto(`/tickets/${key}`);
        await expect(this.root).toBeVisible();
    }

    field(
        name:
            | 'status'
            | 'priority'
            | 'severity'
            | 'type'
            | 'assignee'
            | 'points'
            | 'version'
            | 'labels'
            | 'parent',
    ): Locator {
        return this.root.getByTestId(`field-${name}`);
    }

    async pick(
        name: 'status' | 'priority' | 'severity' | 'type' | 'assignee' | 'points',
        option: string,
    ): Promise<void> {
        await this.field(name).click();
        const picker = this.page.getByTestId('inline-picker');
        await picker.getByRole('option', { name: new RegExp(`^${option}(\\s|$)`) }).click();
        await expect(picker).toBeHidden();
    }

    async setParent(query: string, optionText: string): Promise<void> {
        await this.field('parent').click();
        const picker = this.page.getByTestId('search-picker');
        await picker.getByTestId('search-picker-input').fill(query);
        await picker.getByRole('option', { name: optionText }).click();
        await expect(picker).toBeHidden();
    }

    async rename(title: string): Promise<void> {
        await this.title.click();
        const input = this.root.getByTestId('title-input');
        await input.fill(title);
        await input.press('Enter');
    }

    async comment(body: string): Promise<void> {
        await this.composer.fill(body);
        await this.composer.press('ControlOrMeta+Enter');
    }
}
