import { expect, Locator, Page } from '@playwright/test';

/// The authenticated app frame: sidebar, top bar, user menu and command palette.
export class ShellPage {
    readonly root: Locator;
    readonly sidebar: Locator;
    readonly topbar: Locator;
    readonly breadcrumbs: Locator;
    readonly themeToggle: Locator;
    readonly userMenu: Locator;
    readonly paletteTrigger: Locator;
    readonly palette: Locator;

    constructor(private readonly page: Page) {
        this.root = page.getByTestId('app-shell');
        this.sidebar = page.getByTestId('sidebar');
        this.topbar = page.getByTestId('topbar');
        this.breadcrumbs = page.getByTestId('breadcrumbs');
        this.themeToggle = this.topbar.getByTestId('theme-toggle');
        this.userMenu = page.getByTestId('user-menu');
        this.paletteTrigger = page.getByTestId('palette-trigger');
        this.palette = page.getByTestId('command-palette');
    }

    async expectVisible(): Promise<void> {
        await expect(this.root).toBeVisible();
        await expect(this.sidebar).toBeVisible();
        await expect(this.topbar).toBeVisible();
    }

    theme(): Promise<string | null> {
        return this.page.locator('html').getAttribute('data-theme');
    }

    async toggleTheme(): Promise<void> {
        await this.themeToggle.click();
    }

    async signOut(): Promise<void> {
        await this.userMenu.click();
        await this.page.getByTestId('menu-logout').click();
    }

    navLink(testId: string): Locator {
        return this.sidebar.getByTestId(testId);
    }
}
