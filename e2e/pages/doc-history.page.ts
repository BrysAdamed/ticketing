import { expect, Locator, Page } from '@playwright/test';

/// Version history of a doc (`?history=n`) and one older version (`?v=n`).
export class DocHistoryPage {
    readonly view: Locator;
    readonly bar: Locator;
    readonly panel: Locator;
    readonly diff: Locator;
    readonly stats: Locator;
    readonly titleChange: Locator;
    readonly restoreButton: Locator;
    readonly versionView: Locator;
    readonly versionBanner: Locator;
    readonly versionRestore: Locator;

    constructor(private readonly page: Page) {
        this.view = page.getByTestId('view-docs.history');
        this.bar = page.getByTestId('doc-history-bar');
        this.panel = page.getByTestId('doc-history-panel');
        this.diff = page.getByTestId('doc-diff');
        this.stats = page.getByTestId('doc-history-stats');
        this.titleChange = page.getByTestId('doc-history-title-change');
        this.restoreButton = page.getByTestId('doc-history-restore');
        this.versionView = page.getByTestId('view-docs.version');
        this.versionBanner = page.getByTestId('doc-version-banner');
        this.versionRestore = page.getByTestId('doc-version-restore');
    }

    version(number: number): Locator {
        return this.panel.getByTestId(`doc-history-v${number}`);
    }

    async open(): Promise<void> {
        await this.page.locator('body').press('h');
        await expect(this.panel).toBeVisible({ timeout: 15_000 });
    }

    async mode(mode: 'changes' | 'rendered'): Promise<void> {
        await this.page.getByTestId(`doc-history-mode-${mode}`).click();
    }

    async layout(layout: 'unified' | 'split'): Promise<void> {
        await this.page.getByTestId(`doc-history-layout-${layout}`).click();
    }

    async confirmRestore(): Promise<void> {
        await this.page.getByTestId('confirm-ok').click();
    }
}
