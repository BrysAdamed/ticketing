import { expect, Locator, Page } from '@playwright/test';

/// A Canvas diagram (`/projects/:key/docs/:docKey`): the picture in the reader and, with
/// `?mode=edit`, the Excalidraw editor under the edit bar.
export class DocCanvasPage {
    readonly figure: Locator;
    readonly picture: Locator;
    readonly editor: Locator;
    readonly canvas: Locator;
    readonly status: Locator;
    readonly title: Locator;

    constructor(private readonly page: Page) {
        this.figure = page.getByTestId('doc-diagram');
        this.picture = this.figure.getByTestId('diagram-stage').locator('img.tk-canvas-picture');
        this.editor = page.getByTestId('view-docs.diagram.canvas.edit');
        this.canvas = this.editor.locator('.excalidraw canvas.interactive');
        this.status = page.getByTestId('doc-editor-status');
        this.title = page.getByTestId('doc-editor-title');
    }

    async goto(projectKey: string, docKey: string, edit = false): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/docs/${docKey}${edit ? '?mode=edit' : ''}`);
        await (edit ? this.waitForEditor() : expect(this.figure).toBeVisible({ timeout: 15_000 }));
    }

    async waitForEditor(): Promise<void> {
        await expect(this.canvas).toBeVisible({ timeout: 20_000 });
        await expect(this.page.getByTestId('doc-editor-loading')).toBeHidden({ timeout: 20_000 });
    }

    /// Draws a rectangle with the `R` tool between two points of the canvas (relative to its
    /// top-left corner; keep x above 300, the style panel covers the left) and types a label.
    async box(x: number, y: number, width: number, height: number, label: string): Promise<void> {
        await this.focus();
        await this.page.keyboard.press('r');
        await this.drag(x, y, x + width, y + height);
        await this.page.keyboard.press('Enter');
        await this.page.keyboard.type(label);
        await this.page.keyboard.press('Escape');
        await this.page.keyboard.press('Escape');
    }

    /// Draws an arrow with the `A` tool from one point to another; ending on shapes binds it.
    async arrow(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
        await this.page.keyboard.press('a');
        await this.drag(fromX, fromY, toX, toY);
        await this.page.keyboard.press('Escape');
    }

    /// A freehand stroke with the `P` tool.
    async scribble(x: number, y: number): Promise<void> {
        await this.page.keyboard.press('p');
        const box = await this.canvasBox();
        await this.page.mouse.move(box.x + x, box.y + y);
        await this.page.mouse.down();
        for (let i = 1; i <= 8; i++)
            await this.page.mouse.move(box.x + x + i * 12, box.y + y + (i % 2 ? 14 : -6));
        await this.page.mouse.up();
        await this.page.keyboard.press('Escape');
    }

    /// Clicks an empty corner of the canvas with the selection tool so Excalidraw has the keyboard.
    async focus(): Promise<void> {
        const box = await this.canvas.boundingBox();
        if (!box) throw new Error('The canvas is not visible.');
        await this.page.mouse.click(box.x + box.width - 160, box.y + box.height - 160);
    }

    async publish(): Promise<void> {
        await this.page.keyboard.press('ControlOrMeta+s');
    }

    private async drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
        const box = await this.canvasBox();
        await this.page.mouse.move(box.x + fromX, box.y + fromY);
        await this.page.mouse.down();
        await this.page.mouse.move(box.x + toX, box.y + toY, { steps: 8 });
        await this.page.mouse.up();
    }

    private async canvasBox(): Promise<{ x: number; y: number }> {
        const box = await this.canvas.boundingBox();
        if (!box) throw new Error('The canvas is not visible.');
        return box;
    }
}
