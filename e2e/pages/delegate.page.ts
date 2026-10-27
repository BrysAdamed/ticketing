import { Locator, Page } from '@playwright/test';

declare global {
    interface Window {
        __tkLaunched?: string[];
    }
}

/// Delegate to agent in a ticket view's header. `stubLaunches()` replaces what ExternalUrlLauncher
/// does (a temporary anchor click on a `claude-cli:` / `claude:` URL) with a recorder, so no OS
/// handler runs and the test can read the URLs.
export class DelegatePage {
    readonly action: Locator;
    readonly button: Locator;
    readonly menuTrigger: Locator;
    readonly setupLink: Locator;
    readonly folderDialog: Locator;
    readonly folderInput: Locator;
    readonly folderSave: Locator;
    readonly folderError: Locator;

    constructor(
        private readonly page: Page,
        root: Locator,
    ) {
        this.action = root.getByTestId('ticket-action-delegate');
        this.button = this.action.getByTestId('delegate-button');
        this.menuTrigger = this.action.getByTestId('delegate-menu');
        this.setupLink = this.action.getByTestId('delegate-setup');
        this.folderDialog = page.getByTestId('agent-folder-dialog');
        this.folderInput = this.folderDialog.getByTestId('agent-folder-input');
        this.folderSave = this.folderDialog.getByTestId('agent-folder-save');
        this.folderError = this.folderDialog.getByTestId('agent-folder-error');
    }

    static async stubLaunches(page: Page): Promise<void> {
        await page.addInitScript(() => {
            window.__tkLaunched = [];
            const click = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
                if (/^claude(-cli)?:/.test(this.href)) window.__tkLaunched!.push(this.href);
                else click.call(this);
            };
        });
    }

    launched(): Promise<string[]> {
        return this.page.evaluate(() => window.__tkLaunched ?? []);
    }

    menuItem(id: string): Locator {
        return this.page.getByTestId(id);
    }

    async openMenu(): Promise<void> {
        await this.menuTrigger.click();
    }

    async chooseApp(app: 'ClaudeCode' | 'ClaudeDesktop'): Promise<void> {
        await this.openMenu();
        await this.page.getByTestId(`delegate-app-${app}`).click();
    }
}
