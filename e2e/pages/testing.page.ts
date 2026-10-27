import { expect, Locator, Page } from '@playwright/test';

/// Project "Test cases" tab (`/projects/:key/test-cases`) with the editor side pane.
export class TestCasesPage {
    readonly view: Locator;
    readonly editor: Locator;

    constructor(private readonly page: Page) {
        this.view = page.getByTestId('view-testcases.list');
        this.editor = page.getByTestId('view-testcases.editor');
    }

    async goto(projectKey: string, query = ''): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/test-cases${query}`);
        await expect(this.view).toBeVisible();
    }

    row(key: string): Locator {
        return this.page.getByTestId(`tc-row-${key}`);
    }

    statusTab(status: 'All' | 'New' | 'Manual' | 'Automatic'): Locator {
        return this.page.getByTestId(`tc-status-${status}`);
    }

    /// Creates a test case through the editor and returns its key.
    async create(input: {
        title: string;
        status: 'New' | 'Manual' | 'Automatic';
        steps?: string[];
        automation?: string;
    }): Promise<string> {
        await this.page.getByTestId('tc-new').click();
        await expect(this.editor.getByTestId('tc-title')).toHaveValue('');
        await expect(this.editor.getByTestId('tc-editor-key')).toHaveCount(0);
        await this.editor.getByTestId('tc-title').fill(input.title);
        await this.editor.getByTestId(`tc-editor-status-${input.status}`).click();
        if (input.automation) await this.editor.getByTestId('tc-automation').fill(input.automation);
        for (const [index, step] of (input.steps ?? []).entries()) {
            if (index === 0) await this.editor.getByTestId('step-add').click();
            else await this.editor.getByTestId(`step-input-${index - 1}`).press('Enter');
            await this.editor.getByTestId(`step-input-${index}`).fill(step);
        }
        await this.editor.getByTestId('tc-save').click();
        const key = this.editor.getByTestId('tc-editor-key');
        await expect(key).toBeVisible();
        await expect(this.editor.getByTestId('tc-save')).toHaveCount(0);
        return (await key.textContent())!.trim();
    }

    /// The editor's autosave indicator; `data-state` is pending, saving, saved, invalid or failed.
    get saveState(): Locator {
        return this.editor.getByTestId('tc-save-state');
    }

    async expectSaved(): Promise<void> {
        await expect(this.saveState).toHaveAttribute('data-state', 'saved');
    }

    /// Links the open test case to a ticket through the picker; the link saves right away.
    async linkTicket(ticketKey: string): Promise<void> {
        await this.editor.getByTestId('tc-ticket-picker').click();
        await this.page.getByTestId('search-picker-input').fill(ticketKey);
        await this.page.getByRole('option', { name: new RegExp(ticketKey) }).click();
        await expect(this.editor.getByTestId('tc-ticket')).toContainText(ticketKey);
        await this.expectSaved();
    }
}

/// Regressions tab and the session execution view (`/projects/:key/regressions/:sessionKey`).
export class RegressionsPage {
    readonly list: Locator;
    readonly session: Locator;
    readonly pane: Locator;

    constructor(private readonly page: Page) {
        this.list = page.getByTestId('view-regressions.list');
        this.session = page.getByTestId('view-regressions.session');
        this.pane = page.getByTestId('item-pane');
    }

    async goto(projectKey: string): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/regressions`);
        await expect(this.list).toBeVisible();
    }

    async start(version: string): Promise<void> {
        await this.page.getByTestId('regression-start').click();
        const dialog = this.page.getByTestId('start-session-dialog');
        await expect(dialog.getByTestId('session-preview')).toContainText('will be added');
        await dialog.getByTestId('session-version').fill(version);
        await dialog.getByTestId('session-start').click();
        await expect(this.session).toBeVisible();
    }

    item(testCaseKey: string): Locator {
        return this.page.getByTestId(`item-row-${testCaseKey}`);
    }

    async focus(testCaseKey: string): Promise<void> {
        await this.item(testCaseKey).click();
        await expect(this.item(testCaseKey)).toHaveAttribute('aria-current', 'true');
    }
}
