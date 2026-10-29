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

    constructor(private readonly page: Page) {
        this.root = page.getByTestId('view-profile.achievements');
        this.tab = page.getByTestId('profile-tab-achievements');
        this.privacy = this.root.getByTestId('achievements-privacy');
        this.earned = this.root.getByTestId('achievements-group-earned');
        this.toEarn = this.root.getByTestId('achievements-group-to-earn');
        this.secret = this.root.getByTestId('achievements-group-secret');
        this.detail = page.getByTestId('achievement-detail');
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

    shareButton(id: string): Locator {
        return this.root.getByTestId(`achievement-share-${id}`);
    }

    sharedMarker(id: string): Locator {
        return this.tile(id).getByTestId('medal-shared');
    }
}

/// The user card popover (`tk-user-card`) opened from a person's name or avatar.
export class UserCard {
    readonly root: Locator;
    readonly achievements: Locator;

    constructor(page: Page) {
        this.root = page.getByTestId('user-card');
        this.achievements = this.root.getByTestId('user-card-achievements');
    }

    achievement(id: string): Locator {
        return this.root.getByTestId(`user-card-achievement-${id}`);
    }
}
