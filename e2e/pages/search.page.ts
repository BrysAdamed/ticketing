import { expect, Locator, Page } from '@playwright/test';

/// The search page (`/search?…`): text box, filter chips, sort, results and CSV export.
export class SearchPage {
    readonly root: Locator;
    readonly text: Locator;
    readonly results: Locator;
    readonly count: Locator;
    readonly exportButton: Locator;

    constructor(private readonly page: Page) {
        this.root = page.getByTestId('view-search.results');
        this.text = page.getByTestId('search-text');
        this.results = page.getByTestId('search-results');
        this.count = page.getByTestId('search-count');
        this.exportButton = page.getByTestId('search-export');
    }

    async goto(query = ''): Promise<void> {
        await this.page.goto(`/search${query ? `?${query}` : ''}`);
        await expect(this.root).toBeVisible();
    }

    row(key: string): Locator {
        return this.page.getByTestId(`search-row-${key}`);
    }

    rows(): Locator {
        return this.results.locator('[data-testid^="search-row-"]');
    }

    async search(text: string): Promise<void> {
        await this.text.fill(text);
        await this.text.press('Enter');
    }

    /// Opens a filter chip's menu and toggles the option with the given test id suffix (for example `Bug`).
    async toggle(
        filter: 'project' | 'type' | 'status' | 'category',
        option: string,
    ): Promise<void> {
        await this.page.getByTestId(`filter-${filter}`).click();
        await this.page.getByTestId(`filter-${filter}-${option}`).click();
        await this.page.keyboard.press('Escape');
    }
}
