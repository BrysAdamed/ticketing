import { Browser, Page as BrowserPage } from '@playwright/test';
import { DocPagePage } from '../../pages/doc-page.page';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { PASSWORD, seedUser } from '../identity/identity';

interface Doc {
    key: string;
    title: string;
    content: string | null;
    version: number;
}

interface DocAttachment {
    fileName: string;
    url: string;
}

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

async function createPage(api: Api, projectKey: string, title: string, content: string) {
    return api.post<Doc>(`/projects/${projectKey}/docs`, { kind: 'Page', title, content });
}

/// A second user (Member of a public project) in a browser context of their own.
async function signInAs(browser: Browser, email: string): Promise<BrowserPage> {
    const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await new LoginPage(page).signIn(email, PASSWORD);
    await new ShellPage(page).expectVisible();
    return page;
}

test.describe('docs pages', () => {
    test('edit with live preview, autosave a draft, publish and read the rendered page', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(api, projectKey, 'Payment flow', 'Intro');
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key);

        // Act: E opens the editor; type a page with a callout, headings and code
        await view.startEditing();
        await view.setSource(
            '> [!WARNING]\n> Rotate the key\n\n## Overview\n\nText\n\n## Sequence\n\n```ts\nconst a = 1;\n```\n',
        );

        // Assert: the preview follows and the draft is saved privately
        await expect(view.preview.locator('.tk-md-callout-warning')).toContainText(
            'Rotate the key',
        );
        await expect(view.preview.locator('h2#sequence')).toBeVisible();
        await view.expectStatus('Draft saved');
        const draft = await api.get<{ content: string; baseVersion: number }>(
            `/docs/${doc.key}/draft`,
        );
        expect(draft.baseVersion).toBe(1);
        expect(draft.content).toContain('## Overview');

        // Act: rename inline, add a change note and publish with Mod+S
        await view.titleInput.fill('Payment flows');
        await view.changeNote.fill('Structure');
        await view.publish();

        // Assert
        await view.expectStatus('Published v2');
        const published = await api.get<Doc>(`/docs/${doc.key}`);
        expect(published.version).toBe(2);
        expect(published.title).toBe('Payment flows');
        await expect(page).toHaveURL(/\/payment-flows\?mode=edit$/);

        // Act: Esc closes the editor
        await page.keyboard.press('Escape');

        // Assert: the reader renders callouts, anchors, highlighted code and the outline
        await expect(view.source).toBeHidden();
        await expect(view.title).toHaveText('Payment flows');
        await expect(page.getByTestId('doc-meta')).toContainText(`${doc.key}`);
        await expect(page.getByTestId('doc-meta')).toContainText('v2');
        await expect(view.content.locator('.tk-md-callout-warning')).toBeVisible();
        await expect(view.content.locator('.tk-code .hljs-keyword').first()).toHaveText('const');
        await expect(view.outline.locator('a')).toHaveText(['Overview', 'Sequence']);
        await expect(view.draftBanner).toBeHidden();
    });

    test('reopening shows the unpublished changes banner; Continue and Discard work', async ({
        page,
        api,
    }) => {
        // Arrange: a draft saved earlier
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(api, projectKey, 'Runbook', 'Published text');
        await api.put(`/docs/${doc.key}/draft`, {
            baseVersion: 1,
            title: 'Runbook',
            content: 'Draft text',
        });
        const view = new DocPagePage(page);

        // Act
        await view.goto(projectKey, doc.key);

        // Assert: the reader shows the published text and the banner; the tree marks the doc
        await expect(view.content).toHaveText('Published text');
        await expect(view.draftBanner).toContainText('You have unpublished changes from');

        // Act: Continue editing opens the draft
        await page.getByTestId('doc-draft-continue').click();

        // Assert
        await expect(view.source).toContainText('Draft text');
        await view.expectStatus('Draft saved');

        // Act: close and discard from the banner
        await page.keyboard.press('Escape');
        await page.getByTestId('doc-draft-discard').click();
        await page.getByRole('button', { name: 'Discard' }).last().click();

        // Assert
        await expect(view.draftBanner).toBeHidden();
        const response = await page.request.get(`/api/v1/docs/${doc.key}/draft`);
        expect(response.status()).toBe(404);
    });

    test('another member sees "is editing" within 30 s and never my draft', async ({
        page,
        api,
        browser,
    }) => {
        test.setTimeout(90_000);

        // Arrange: a public project, a page, and Bea reading it
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const doc = await createPage(api, projectKey, 'Shared', 'Base');
        const bea = await seedUser(api, 'presence');
        const beaPage = await signInAs(browser, bea.email);
        const beaView = new DocPagePage(beaPage);
        await beaView.goto(projectKey, doc.key);
        await expect(beaView.presence).toBeHidden();

        // Act: I start typing
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key, true);
        await view.replaceLine(1, 'Base, edited');
        await view.expectStatus('Draft saved');

        // Assert: Bea sees me editing within 30 s, but not my text
        await expect(beaView.presence).toHaveText('Administrator is editing', { timeout: 35_000 });
        await expect(beaView.content).toHaveText('Base');
        const theirs = await beaPage.request.get(`/api/v1/docs/${doc.key}/draft`);
        expect(theirs.status()).toBe(404);

        await beaPage.context().close();
    });

    test('concurrent edits: separate parts merge, the same part opens the conflict view', async ({
        page,
        api,
        browser,
    }) => {
        // Arrange: two writers editing the same version in two browsers
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const doc = await createPage(api, projectKey, 'Plan', 'one\n\ntwo\n\nthree\n\nfour');
        const bea = await seedUser(api, 'merge');
        const beaPage = await signInAs(browser, bea.email);
        const beaView = new DocPagePage(beaPage);
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key, true);
        await beaView.goto(projectKey, doc.key, true);

        // Act: Bea changes the first line and publishes; I change the last line and publish
        await beaView.replaceLine(1, 'ONE');
        await beaView.publish();
        await beaView.expectStatus('Published v2');
        await view.replaceLine(7, 'FOUR');
        await view.publish();

        // Assert: a clean merge is published with a toast
        await expect(page.getByText("Merged with E2E merge's changes (v2)")).toBeVisible();
        await view.expectStatus('Published v3');
        expect((await api.get<Doc>(`/docs/${doc.key}`)).content).toBe(
            'ONE\n\ntwo\n\nthree\n\nFOUR',
        );

        // Act: we both change the second paragraph; Bea (still on v2) publishes last
        await view.replaceLine(3, 'two (mine)');
        await view.publish();
        await view.expectStatus('Published v4');
        await beaView.replaceLine(3, 'two (Bea)');
        await beaView.publish();

        // Assert: Bea gets the conflict view with both texts
        await expect(beaView.conflict).toBeVisible();
        await expect(beaPage.getByTestId('conflict-theirs')).toContainText('two (mine)');
        await expect(beaPage.getByTestId('conflict-mine')).toContainText('two (Bea)');

        // Act: keep editing on the latest version
        await beaPage.getByTestId('conflict-keep').click();

        // Assert: the editor holds v4 and Bea's text sits beside it
        await expect(beaView.conflict).toBeHidden();
        await expect(beaView.source).toContainText('two (mine)');
        await expect(beaPage.getByTestId('doc-editor-reference')).toContainText('two (Bea)');
        await expect(beaPage.getByTestId('doc-editor-base')).toHaveText('based on v4');

        await beaPage.context().close();
    });

    test('dropping an image uploads it to the page and embeds it', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(api, projectKey, 'Screens', 'Before');
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key, true);

        // Act: drop a PNG on the source
        const transfer = await page.evaluateHandle(
            (bytes) => {
                const data = new DataTransfer();
                data.items.add(
                    new File([new Uint8Array(bytes)], 'login screen.png', { type: 'image/png' }),
                );
                return data;
            },
            [...PNG],
        );
        await view.source.dispatchEvent('drop', { dataTransfer: transfer });

        // Assert: the embed replaces the placeholder and the preview shows the image
        await expect(view.source).toContainText('![login screen.png](/api/v1/attachments/');
        await expect(view.preview.locator('img[alt="login screen.png"]')).toBeVisible();
        const attachments = await api.get<DocAttachment[]>(`/docs/${doc.key}/attachments`);
        expect(attachments.map((a) => a.fileName)).toEqual(['login screen.png']);

        // Act: publish and close
        await page.keyboard.press('ControlOrMeta+Enter');

        // Assert: the reader shows the image and the attachments panel lists it
        await expect(view.content.locator('img[alt="login screen.png"]')).toBeVisible();
        await expect(view.attachments).toContainText('login screen.png');
    });
});
