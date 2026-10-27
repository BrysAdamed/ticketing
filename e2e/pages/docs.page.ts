import { expect, Locator, Page } from '@playwright/test';

/// The Docs section (`/projects/:key/docs`): the tree panel, inline create and rename, drag and
/// drop, the row menu, the home and the trash.
export class DocsPage {
    readonly layout: Locator;
    readonly home: Locator;
    readonly tree: Locator;
    readonly createInput: Locator;
    readonly renameInput: Locator;
    readonly filter: Locator;

    constructor(private readonly page: Page) {
        this.layout = page.getByTestId('view-docs.layout');
        this.home = page.getByTestId('view-docs.home');
        this.tree = page.getByTestId('doc-tree-list');
        this.createInput = page.getByTestId('doc-create-input');
        this.renameInput = page.getByTestId('doc-rename-input');
        this.filter = page.getByTestId('doc-tree-filter');
    }

    async goto(projectKey: string): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/docs`);
        await expect(this.layout).toBeVisible();
        await expect(this.tree).toBeVisible();
    }

    row(key: string): Locator {
        return this.page.getByTestId(`doc-row-${key}`);
    }

    /// Row titles in display order, indented by depth (`  child`).
    async outline(): Promise<string[]> {
        return this.tree
            .locator('[role="treeitem"]')
            .evaluateAll((rows) =>
                rows.map(
                    (r) =>
                        '  '.repeat(Number(r.getAttribute('aria-level') ?? '1') - 1) +
                        (r.querySelector('.nm')?.textContent?.trim() ?? ''),
                ),
            );
    }

    /// Creates a doc with the keyboard: `N` page, `Shift+N` folder, `Shift+D` diagram.
    async create(key: 'N' | 'Shift+N' | 'Shift+D', title: string): Promise<void> {
        await this.page.locator('body').press(key);
        await expect(this.createInput).toBeFocused();
        await this.createInput.fill(title);
        await this.createInput.press('Enter');
    }

    /// Drags a row and drops it onto the middle of a folder row (moves it inside).
    async dragInto(key: string, folderKey: string): Promise<void> {
        const source = await this.row(key).boundingBox();
        const target = await this.row(folderKey).boundingBox();
        if (!source || !target) throw new Error('Rows are not visible.');
        await this.page.mouse.move(source.x + 60, source.y + source.height / 2);
        await this.page.mouse.down();
        await this.page.mouse.move(source.x + 60, source.y + source.height / 2 - 8, { steps: 4 });
        await this.page.mouse.move(target.x + 60, target.y + target.height / 2, { steps: 12 });
        await expect(this.row(folderKey)).toHaveClass(/drop-into/);
        await this.page.mouse.up();
    }

    async openMenu(key: string): Promise<void> {
        await this.row(key).click({ button: 'right' });
        await expect(this.page.getByTestId('doc-menu-copy-link')).toBeVisible();
    }
}
