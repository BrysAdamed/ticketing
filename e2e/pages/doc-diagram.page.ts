import { expect, Locator, Page } from '@playwright/test';

/// One diagram doc (`/projects/:key/docs/:docKey`): the rendered diagram with zoom and, with
/// `?mode=edit`, the Mermaid editor with its live preview and error strip.
export class DocDiagramPage {
    readonly reader: Locator;
    readonly figure: Locator;
    readonly label: Locator;
    readonly svg: Locator;
    readonly zoomLevel: Locator;
    readonly zoomIn: Locator;
    readonly zoomFit: Locator;
    readonly readerError: Locator;
    readonly editor: Locator;
    readonly source: Locator;
    readonly preview: Locator;
    readonly previewSvg: Locator;
    readonly previewError: Locator;
    readonly status: Locator;

    constructor(private readonly page: Page) {
        this.reader = page.getByTestId('view-docs.diagram');
        this.figure = page.getByTestId('doc-diagram');
        this.label = page.getByTestId('doc-diagram-label');
        this.svg = this.figure.getByTestId('diagram-stage').locator('svg');
        this.zoomLevel = this.figure.getByTestId('diagram-zoom-level');
        this.zoomIn = this.figure.getByTestId('diagram-zoom-in');
        this.zoomFit = this.figure.getByTestId('diagram-zoom-fit');
        this.readerError = page.getByTestId('doc-diagram-error');
        this.editor = page.getByTestId('view-docs.diagram.mermaid.edit');
        this.source = page.getByTestId('doc-editor-source');
        this.preview = page.getByTestId('mermaid-preview');
        this.previewSvg = this.preview.getByTestId('diagram-stage').locator('svg');
        this.previewError = page.getByTestId('mermaid-error');
        this.status = page.getByTestId('doc-editor-status');
    }

    async goto(projectKey: string, docKey: string, edit = false): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/docs/${docKey}${edit ? '?mode=edit' : ''}`);
        await expect(edit ? this.source : this.figure).toBeVisible({ timeout: 15_000 });
    }

    async startEditing(): Promise<void> {
        await this.page.locator('body').press('e');
        await expect(this.source).toBeVisible({ timeout: 15_000 });
    }

    async setSource(text: string): Promise<void> {
        await this.source.click();
        await this.page.keyboard.press('ControlOrMeta+a');
        await this.page.keyboard.insertText(text);
    }

    async publish(): Promise<void> {
        await this.page.keyboard.press('ControlOrMeta+s');
    }
}
