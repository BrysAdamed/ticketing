import { Locator, Page } from '@playwright/test';

/// Profile → Achievements (`profile.achievements`): the grouped medal grid and the detail popover.
export class AchievementsPage {
    readonly root: Locator;
    readonly tab: Locator;
    readonly privacy: Locator;
    readonly earned: Locator;
    readonly toEarn: Locator;
    readonly secret: Locator;
    readonly detail: Locator;
    /// The unlock toast and, in the top bar, the avatar dot and the account menu's item (TKT-67).
    readonly toast: Locator;
    readonly dot: Locator;
    readonly menuItem: Locator;

    constructor(private readonly page: Page) {
        this.root = page.getByTestId('view-profile.achievements');
        this.tab = page.getByTestId('profile-tab-achievements');
        this.privacy = this.root.getByTestId('achievements-privacy');
        this.earned = this.root.getByTestId('achievements-group-earned');
        this.toEarn = this.root.getByTestId('achievements-group-to-earn');
        this.secret = this.root.getByTestId('achievements-group-secret');
        this.detail = page.getByTestId('achievement-detail');
        this.toast = page.getByTestId('achievement-toast');
        this.dot = page.getByTestId('achievements-dot');
        this.menuItem = page.getByTestId('menu-achievements');
    }

    async goto(): Promise<void> {
        await this.page.goto('/profile/achievements');
    }

    tile(id: string): Locator {
        return this.root.getByTestId(`achievement-tile-${id}`);
    }

    openButton(id: string): Locator {
        return this.root.getByTestId(`achievement-open-${id}`);
    }
}
