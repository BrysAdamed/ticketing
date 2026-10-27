import { Locator, Page } from '@playwright/test';

/// The top bar bell with its unread badge and the notifications panel it opens (`G N`).
export class NotificationsPanel {
    readonly bell: Locator;
    readonly badge: Locator;
    readonly panel: Locator;
    readonly markAll: Locator;

    constructor(private readonly page: Page) {
        this.bell = page.getByTestId('notifications-bell');
        this.badge = this.bell.getByTestId('notifications-badge');
        this.panel = page.getByTestId('notifications-panel');
        this.markAll = this.panel.getByTestId('notifications-mark-all');
    }

    row(id: string): Locator {
        return this.panel.getByTestId(`notification-row-${id}`);
    }

    filter(value: 'all' | 'unread'): Locator {
        return this.panel.getByTestId(`notifications-filter-${value}`);
    }

    async openWithShortcut(): Promise<void> {
        await this.page.keyboard.press('g');
        await this.page.keyboard.press('n');
    }

    /// The SPA refreshes the unread count when the window gets focus.
    async focusWindow(): Promise<void> {
        await this.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    }
}
