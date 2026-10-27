import { expect, Locator, Page } from '@playwright/test';

/// One docs page (`/projects/:key/docs/:docKey`): the reader and, with `?mode=edit`, the
/// CodeMirror editor with its draft status, preview and conflict view.
export class DocPagePage {
    readonly reader: Locator;
    readonly title: Locator;
    readonly content: Locator;
    readonly outline: Locator;
    readonly draftBanner: Locator;
    readonly presence: Locator;
    readonly editButton: Locator;
    readonly editor: Locator;
    readonly source: Locator;
    readonly titleInput: Locator;
    readonly status: Locator;
    readonly preview: Locator;
    readonly changeNote: Locator;
    readonly conflict: Locator;
    readonly attachments: Locator;
    readonly comments: Locator;
    readonly commentComposer: Locator;
    readonly metaComments: Locator;

    constructor(private readonly page: Page) {
        this.reader = page.getByTestId('view-docs.page');
        this.title = page.getByTestId('doc-title');
        this.content = page.getByTestId('doc-content');
        this.outline = page.getByTestId('doc-outline');
        this.draftBanner = page.getByTestId('doc-draft-banner');
        this.presence = page.getByTestId('doc-presence');
        this.editButton = page.getByTestId('doc-edit');
        this.editor = page.getByTestId('view-docs.page.edit');
        this.source = page.getByTestId('doc-editor-source');
        this.titleInput = page.getByTestId('doc-editor-title');
        this.status = page.getByTestId('doc-editor-status');
        this.preview = page.getByTestId('doc-editor-preview');
        this.changeNote = page.getByTestId('doc-editor-change-note');
        this.conflict = page.getByTestId('doc-conflict');
        this.attachments = page.getByTestId('doc-attachments');
        this.comments = page.getByTestId('doc-comments');
        this.commentComposer = this.comments
            .getByTestId('doc-comment-composer')
            .getByRole('textbox');
        this.metaComments = page.getByTestId('doc-meta-comments');
    }

    async goto(projectKey: string, docKey: string, edit = false): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/docs/${docKey}${edit ? '?mode=edit' : ''}`);
        await expect(edit ? this.source : this.title).toBeVisible();
    }

    /// Posts a comment through the composer (Mod+Enter).
    async comment(body: string): Promise<void> {
        await this.commentComposer.fill(body);
        await this.commentComposer.press('ControlOrMeta+Enter');
    }

    /// The comment cards of the thread, oldest first.
    commentCards(): Locator {
        return this.comments.locator('article.cmt');
    }

    async startEditing(): Promise<void> {
        await this.page.locator('body').press('e');
        await expect(this.source).toBeVisible({ timeout: 15_000 });
    }

    /// Replaces line `line` (1-based) of the source with `text`.
    async replaceLine(line: number, text: string): Promise<void> {
        const target = this.source.locator('.cm-line').nth(line - 1);
        await target.click();
        await this.page.keyboard.press('Home');
        await this.page.keyboard.press('Shift+End');
        await this.page.keyboard.type(text);
    }

    /// Replaces the whole source, as a paste would (no list or quote continuation on Enter).
    async setSource(text: string): Promise<void> {
        await this.source.click();
        await this.page.keyboard.press('ControlOrMeta+a');
        await this.page.keyboard.insertText(text);
    }

    async publish(): Promise<void> {
        await this.page.keyboard.press('ControlOrMeta+s');
    }

    async expectStatus(text: string | RegExp): Promise<void> {
        await expect(this.status).toContainText(text);
    }
}
