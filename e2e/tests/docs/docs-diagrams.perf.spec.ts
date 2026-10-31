import { DocDiagramPage } from '../../pages/doc-diagram.page';
import { expect, test } from '../../support/fixtures';
import { LLM_FLOWCHART } from '../../support/diagrams';

/// Budget of the Mermaid slice: one diagram renders in the diagram view in under 1 s
/// (`tk-diagram-render` measure). Run alone: `E2E_PERF=1 npx playwright test --project=perf`.
test('a flowchart written by an LLM renders in the diagram view in under a second', async ({
    page,
    api,
}) => {
    test.skip(process.env.E2E_PERF !== '1', 'Set E2E_PERF=1 and run the perf project alone.');

    // Arrange
    const projectKey = (await api.createProject()).key;
    const diagram = await api.post<{ key: string }>(`/projects/${projectKey}/docs`, {
        kind: 'Diagram',
        diagramFormat: 'Mermaid',
        title: 'System context',
        content: LLM_FLOWCHART,
    });
    const view = new DocDiagramPage(page);

    // Act
    await view.goto(projectKey, diagram.key);
    await expect(view.figure).toHaveAttribute('data-state', 'ready');
    const renderMs = await page.evaluate(() =>
        Math.max(...performance.getEntriesByName('tk-diagram-render').map((e) => e.duration)),
    );

    // Assert
    console.log(`Mermaid flowchart: render ${Math.round(renderMs)} ms`);
    expect(renderMs).toBeLessThan(1000);
});
