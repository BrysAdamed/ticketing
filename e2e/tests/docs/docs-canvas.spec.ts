import { DocCanvasPage } from '../../pages/doc-canvas.page';
import { DocsPage } from '../../pages/docs.page';
import { Api } from '../../support/api';
import { chainScene, largeScene } from '../../support/canvas';
import { BASE_URL } from '../../support/env';
import { expect, test } from '../../support/fixtures';

interface Doc {
    key: string;
    title: string;
    content: string | null;
    version: number;
    outline: string | null;
    snapshotUrl: string | null;
    embeds: { key: string; snapshotUrl: string | null }[];
}

function createCanvas(api: Api, projectKey: string, title: string, content = '') {
    return api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Diagram',
        diagramFormat: 'Canvas',
        title,
        content,
    });
}

test.describe('Canvas diagrams', () => {
    test('New diagram → Canvas opens Excalidraw; boxes, a bound arrow and a scribble publish with their picture', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const docs = new DocsPage(page);
        const canvas = new DocCanvasPage(page);
        const external: string[] = [];
        // Excalidraw lists its CDN as a second font source; the page CSP blocks it before it is
        // sent (ADR 0013), so no external request ever gets a response.
        page.on('response', (response) => {
            const url = response.url();
            if (/^https?:/.test(url) && new URL(url).origin !== new URL(BASE_URL).origin)
                external.push(url);
        });
        await docs.goto(projectKey);

        // Act: Shift+D, pick Canvas, name it
        await page.locator('body').press('Shift+D');
        await page.getByTestId('doc-create-format-Canvas').dispatchEvent('mousedown');
        await docs.createInput.fill('Request path');
        await docs.createInput.press('Enter');

        // Assert: the editor opens right away
        await canvas.waitForEditor();
        await expect(page).toHaveURL(/mode=edit/);

        // Act: draw API → DB, scribble, publish
        await canvas.box(340, 120, 160, 80, 'API');
        await canvas.box(680, 120, 160, 80, 'DB');
        await canvas.arrow(505, 160, 675, 160);
        await canvas.scribble(380, 360);
        await page.keyboard.press('ControlOrMeta+z');
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await canvas.publish();

        // Assert
        await expect(canvas.status).toContainText('Published v2', { timeout: 15_000 });
        const tree = await api.get<{ items: { key: string; title: string }[] }>(
            `/projects/${projectKey}/docs/tree`,
        );
        const key = tree.items.find((i) => i.title === 'Request path')!.key;
        const published = await api.get<Doc>(`/docs/${key}`);
        expect(published.outline).toBe('API\nDB\nAPI → DB');
        expect(published.snapshotUrl).toBe(`/api/v1/docs/${key}/versions/2/snapshot.svg`);
        const scene = JSON.parse(published.content!) as { elements: { type: string }[] };
        expect(scene.elements.map((e) => e.type)).toEqual(
            expect.arrayContaining(['rectangle', 'text', 'arrow', 'freedraw']),
        );
        expect(external).toEqual([]);

        // Act: close; the reader shows the stored picture
        await page.getByTestId('doc-editor-close').click();

        // Assert
        await expect(canvas.picture).toHaveAttribute('src', published.snapshotUrl!);
        await expect(page.getByTestId('doc-diagram-label')).toHaveText('Canvas');
    });

    test('a canvas written over the API gets its picture from the first writer who opens it; pages embed it', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await createCanvas(
            api,
            projectKey,
            'Services',
            chainScene('Web', 'API', 'DB'),
        );
        const host = await api.post<Doc>(`/projects/${projectKey}/docs`, {
            kind: 'Page',
            title: 'Architecture',
            content: `# Architecture\n\n![Services](${diagram.key})`,
        });
        const canvas = new DocCanvasPage(page);
        const embed = page.locator(`figure.tk-doc-embed[data-doc-key="${diagram.key}"]`);

        // Act: the page before anyone opened the diagram
        await page.goto(`/projects/${projectKey}/docs/${host.key}`);

        // Assert
        await expect(embed.getByTestId('doc-embed-notice')).toHaveText('Preview not rendered yet');

        // Act: open the diagram (exports and stores the picture)
        await canvas.goto(projectKey, diagram.key);

        // Assert
        await expect(canvas.figure).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
        await expect
            .poll(async () => (await api.get<Doc>(`/docs/${diagram.key}`)).snapshotUrl, {
                timeout: 10_000,
            })
            .toBe(`/api/v1/docs/${diagram.key}/versions/1/snapshot.svg`);

        // Act: back to the page; click the picture
        await page.goto(`/projects/${projectKey}/docs/${host.key}`);
        const picture = embed.locator('a.tk-doc-embed-open img');
        await expect(picture).toBeVisible();
        expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(
            0,
        );
        await picture.click();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/docs/${diagram.key}`));
        await expect(canvas.picture).toBeVisible();
    });

    test('a concurrent publish opens the drawings conflict view: overwrite with mine', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await createCanvas(api, projectKey, 'Flow', chainScene('Start', 'End'));
        const canvas = new DocCanvasPage(page);
        await canvas.goto(projectKey, diagram.key, true);
        await canvas.box(420, 320, 160, 80, 'Mine');
        await expect(canvas.status).toContainText('Draft saved', { timeout: 10_000 });
        await api.patch(`/docs/${diagram.key}`, {
            content: chainScene('Start', 'Theirs', 'End'),
            baseVersion: 1,
        });

        // Act
        await canvas.publish();

        // Assert
        const conflict = page.getByTestId('doc-conflict');
        await expect(conflict).toBeVisible();
        await expect(conflict.getByTestId('conflict-keep')).toHaveCount(0);
        await expect(conflict.getByTestId('conflict-theirs').locator('img')).toBeVisible();
        await expect(conflict.getByTestId('conflict-mine').locator('img')).toBeVisible();

        // Act
        await conflict.getByTestId('conflict-overwrite').click();

        // Assert
        await expect(conflict).toBeHidden();
        await expect(canvas.status).toContainText('Published v3');
        const latest = await api.get<Doc>(`/docs/${diagram.key}`);
        expect(latest.outline).toContain('Mine');
        expect(latest.outline).not.toContain('Theirs');

        // Act: compare theirs (v2) with mine (v3) in the history
        await page.goto(`/projects/${projectKey}/docs/${diagram.key}?history=3&with=2`);

        // Assert: both versions drawn side by side
        const sides = page.getByTestId('doc-history-canvas').locator('tk-canvas-picture');
        await expect(sides).toHaveCount(2);
        await expect(sides.locator('img.tk-canvas-picture')).toHaveCount(2, { timeout: 15_000 });
    });

    test('pasting or dropping an image is refused with a hint', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await createCanvas(api, projectKey, 'No images');
        const canvas = new DocCanvasPage(page);
        await canvas.goto(projectKey, diagram.key, true);

        // Act
        await canvas.canvas.evaluate((target) => {
            const data = new DataTransfer();
            data.items.add(
                new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }),
            );
            target.dispatchEvent(
                new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }),
            );
        });

        // Assert
        await expect(page.getByText('Images go in pages:')).toBeVisible();
        await expect(
            page.getByTestId('view-docs.diagram.canvas.edit').getByText('Images go in pages'),
        ).toBeVisible();
    });

    test('closing the tab with unsaved changes to a drawing over 64 KB saves them and asks first', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const scene = largeScene(600);
        expect(scene.length).toBeGreaterThan(64 * 1024);
        const diagram = await createCanvas(api, projectKey, 'Big map', scene);
        const canvas = new DocCanvasPage(page);
        await canvas.goto(projectKey, diagram.key, true);
        const draftContent = () =>
            api
                .get<{ content: string }>(`/docs/${diagram.key}/draft`)
                .then((draft) => draft.content)
                .catch(() => '');
        const asked = new Promise<string>((resolve) =>
            page.once('dialog', (dialog) => {
                resolve(dialog.type());
                void expect
                    .poll(draftContent, { timeout: 15_000 })
                    .toContain('Late')
                    .finally(() => dialog.accept());
            }),
        );

        // Act: draw, then close before the autosave runs
        await canvas.box(420, 320, 160, 80, 'Late');
        await page.close({ runBeforeUnload: true });

        // Assert: the browser asked, and the draft was saved while it did
        expect(await asked).toBe('beforeunload');
        await expect.poll(draftContent, { timeout: 15_000 }).toContain('Late');
        await expect.poll(() => page.isClosed()).toBe(true);
    });
});
