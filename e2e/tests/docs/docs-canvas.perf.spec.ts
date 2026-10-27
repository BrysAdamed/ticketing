import { DocCanvasPage } from '../../pages/doc-canvas.page';
import { largeScene } from '../../support/canvas';
import { expect, test } from '../../support/fixtures';

/// Budget of TKT-18: opening a 2 000-element canvas takes under 1.5 s, in the editor and in the
/// reader. Run alone: `E2E_PERF=1 npx playwright test --project=perf`.
test('a 2 000-element canvas opens in the editor and the reader in under 1.5 s', async ({
    page,
    api,
}) => {
    test.skip(process.env.E2E_PERF !== '1', 'Set E2E_PERF=1 and run the perf project alone.');

    // Arrange
    const projectKey = (await api.createProject()).key;
    const content = largeScene(2000);
    const diagram = await api.post<{ key: string }>(`/projects/${projectKey}/docs`, {
        kind: 'Diagram',
        diagramFormat: 'Canvas',
        title: 'Big map',
        content,
    });
    expect((JSON.parse(content) as { elements: unknown[] }).elements).toHaveLength(2000);
    const canvas = new DocCanvasPage(page);
    await canvas.goto(projectKey, diagram.key);
    await expect(canvas.figure).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await expect
        .poll(
            async () =>
                (await api.get<{ snapshotUrl: string | null }>(`/docs/${diagram.key}`)).snapshotUrl,
        )
        .not.toBeNull();
    await page.goto('/');

    // Act: open the editor (chunks cached, as on a second visit)
    let started = Date.now();
    await canvas.goto(projectKey, diagram.key, true);
    const editorMs = Date.now() - started;
    const openMeasure = await page.evaluate(() =>
        Math.max(...performance.getEntriesByName('tk-canvas-open').map((e) => e.duration)),
    );

    // Act: open the reader with the stored picture
    await page.goto('/');
    started = Date.now();
    await canvas.goto(projectKey, diagram.key);
    await expect(canvas.picture).toBeVisible();
    const readerMs = Date.now() - started;

    // Assert
    console.log(
        `2 000 elements: editor ${editorMs} ms (view ${Math.round(openMeasure)} ms), reader ${readerMs} ms`,
    );
    expect(editorMs).toBeLessThan(1500);
    expect(readerMs).toBeLessThan(1500);
});
