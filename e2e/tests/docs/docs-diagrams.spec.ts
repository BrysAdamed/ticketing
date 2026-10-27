import { Page as BrowserPage } from '@playwright/test';
import { DocDiagramPage } from '../../pages/doc-diagram.page';
import { DocPagePage } from '../../pages/doc-page.page';
import { ShellPage } from '../../pages/shell.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface Doc {
    key: string;
    title: string;
    content: string | null;
    version: number;
}

/// What an LLM writes when asked for a diagram (the same source the MCP tool accepts).
const LLM_FLOWCHART = [
    'flowchart LR',
    '  client([Browser]) -->|HTTPS| web[nginx + SPA]',
    '  web --> api[Ticketing API]',
    '  api --> db[(PostgreSQL)]',
    '  api -. MCP .-> llm{{Claude Code}}',
].join('\n');

function createDiagram(api: Api, projectKey: string, title: string, content: string) {
    return api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Diagram',
        diagramFormat: 'Mermaid',
        title,
        content,
    });
}

function createPage(api: Api, projectKey: string, title: string, content: string) {
    return api.post<Doc>(`/projects/${projectKey}/docs`, { kind: 'Page', title, content });
}

function fence(source: string): string {
    return '```mermaid\n' + source + '\n```';
}

/// Sum of the layout shifts so far that moved something inside the doc's content (the app shell
/// settling on load is not the diagrams' doing).
function contentLayoutShift(page: BrowserPage): Promise<number> {
    return page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                const content = document.querySelector('[data-testid="doc-content"]');
                let total = 0;
                new PerformanceObserver((list) => {
                    for (const entry of list.getEntries() as (PerformanceEntry & {
                        value: number;
                        hadRecentInput: boolean;
                        sources?: { node?: Node | null }[];
                    })[]) {
                        const inContent = entry.sources?.some(
                            (source) => source.node && content?.contains(source.node),
                        );
                        if (!entry.hadRecentInput && inContent) total += entry.value;
                    }
                }).observe({ type: 'layout-shift', buffered: true });
                setTimeout(() => resolve(total), 300);
            }),
    );
}

test.describe('Mermaid diagrams', () => {
    test('a flowchart written by an LLM renders in the diagram view in under a second, with zoom and fit', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await createDiagram(api, projectKey, 'System context', LLM_FLOWCHART);
        const view = new DocDiagramPage(page);

        // Act
        await view.goto(projectKey, diagram.key);

        // Assert
        await expect(view.figure).toHaveAttribute('data-state', 'ready');
        await expect(view.label).toHaveText('Mermaid · flowchart');
        await expect(view.svg).toContainText('Ticketing API');
        await expect(view.svg.locator('a, script, foreignObject')).toHaveCount(0);
        const renderMs = await page.evaluate(() =>
            Math.max(...performance.getEntriesByName('tk-diagram-render').map((e) => e.duration)),
        );
        expect(renderMs).toBeLessThan(1000);

        // Act: zoom in with the button and `=`, then fit with `0`
        const fitted = await view.zoomLevel.innerText();
        await view.zoomIn.click();
        await page.locator('body').press('=');

        // Assert
        await expect(view.zoomLevel).not.toHaveText(fitted);
        await page.locator('body').press('0');
        await expect(view.zoomLevel).toHaveText(fitted);
    });

    test('edit with a live preview that keeps the last good render on a syntax error, then publish', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await createDiagram(api, projectKey, 'Order states', '');
        const view = new DocDiagramPage(page);
        await view.goto(projectKey, diagram.key);
        await expect(page.getByTestId('doc-diagram-empty')).toBeVisible();

        // Act: E opens the editor; start from the state template
        await view.startEditing();
        await page.getByTestId('mermaid-start-state').click();

        // Assert
        await expect(view.previewSvg).toContainText('Submitted');
        await expect(page.getByTestId('mermaid-type')).toHaveText('Mermaid · state');

        // Act: break the source
        await view.setSource('stateDiagram-v2\n  [*] --> Draft\n  Draft --> ');

        // Assert: the error names the line, the last good render stays (dimmed)
        await expect(view.previewError).toContainText('line');
        await expect(view.previewSvg).toContainText('Submitted');
        await expect(page.getByTestId('diagram-viewport')).toHaveClass(/stale/);

        // Act: publishing invalid source asks first; cancel, fix it and publish
        await view.publish();
        await page.getByRole('button', { name: 'Cancel' }).click();
        await view.setSource(
            'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Shipped\n  Shipped --> [*]',
        );
        await expect(view.previewError).toBeHidden();
        await expect(view.previewSvg).toContainText('Shipped');
        await view.publish();

        // Assert
        await expect(view.status).toContainText('Published v2');
        const published = await api.get<Doc>(`/docs/${diagram.key}`);
        expect(published.content).toContain('Draft --> Shipped');

        // Act: Esc closes the editor
        await page.keyboard.press('Escape');

        // Assert: the reader shows the published diagram
        await expect(view.reader).toBeVisible();
        await expect(view.svg).toContainText('Shipped');
    });

    test('mermaid blocks render in pages, ticket descriptions and comments, with an error box for broken ones', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(
            api,
            projectKey,
            'Architecture',
            `Intro\n\n${fence(LLM_FLOWCHART)}\n\nBroken:\n\n${fence('sequenceDiagram\n  A->>')}\n`,
        );
        const ticket = await api.post<{ key: string }>(`/projects/${projectKey}/tickets`, {
            title: 'Checkout flow',
            type: 'UserStory',
            description: `Flow:\n\n${fence('sequenceDiagram\n  Browser->>API: POST /orders\n  API-->>Browser: 201')}`,
        });
        await api.post(`/tickets/${ticket.key}/comments`, {
            body: fence('flowchart TD\n  Review --> Merge'),
        });

        // Act
        const reader = new DocPagePage(page);
        await reader.goto(projectKey, doc.key);

        // Assert
        await expect(reader.content.locator('figure.tk-mermaid svg')).toContainText(
            'Ticketing API',
        );
        await expect(reader.content.locator('.tk-mermaid-error')).toContainText(
            'Mermaid syntax error',
        );
        await expect(reader.content.locator('pre code.language-mermaid')).toHaveCount(1);

        // Act
        await new TicketPage(page).goto(ticket.key);

        // Assert
        await expect(page.locator('figure.tk-mermaid svg').first()).toBeVisible();
        await expect(page.locator('figure.tk-mermaid svg')).toHaveCount(2);
        await expect(page.locator('figure.tk-mermaid svg').last()).toContainText('Merge');
    });

    test('diagrams re-render in the other theme', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(api, projectKey, 'Themed', fence(LLM_FLOWCHART));
        const reader = new DocPagePage(page);
        await reader.goto(projectKey, doc.key);
        const svg = reader.content.locator('figure.tk-mermaid svg');
        await expect(svg).toBeVisible();
        const before = await svg.getAttribute('id');

        // Act
        await new ShellPage(page).toggleTheme();

        // Assert
        await expect(svg).toBeVisible();
        await expect.poll(() => svg.getAttribute('id')).not.toBe(before);
    });

    test('a page with ten diagrams does not shift its layout while they render', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const blocks = Array.from(
            { length: 10 },
            (_, i) =>
                `## Step ${i + 1}\n\nSome text about step ${i + 1}.\n\n${fence(`flowchart LR\n  S${i}a[Step ${i + 1}] --> S${i}b[Next] --> S${i}c[Done]`)}`,
        );
        const doc = await createPage(api, projectKey, 'Ten diagrams', blocks.join('\n\n'));
        const reader = new DocPagePage(page);

        // Act: first visit, then a revisit (heights are remembered)
        await reader.goto(projectKey, doc.key);
        await expect(reader.content.locator('figure.tk-mermaid').first()).toBeVisible();
        await page.mouse.move(720, 500);
        for (let y = 0; y < 8; y++) {
            await page.mouse.wheel(0, 800);
            await page.waitForTimeout(200);
        }
        await expect(reader.content.locator('figure.tk-mermaid')).toHaveCount(10);
        const firstVisit = await contentLayoutShift(page);
        await page.reload();
        await expect(reader.content.locator('figure.tk-mermaid').first()).toBeVisible();
        const revisit = await contentLayoutShift(page);

        // Assert
        expect(firstVisit).toBeLessThan(0.05);
        expect(revisit).toBe(0);
    });

    test('the page editor inserts an inline Mermaid block and embeds a picked diagram', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await createDiagram(api, projectKey, 'Deployment', LLM_FLOWCHART);
        const doc = await createPage(api, projectKey, 'Runbook', 'Intro');
        const editor = new DocPagePage(page);
        await editor.goto(projectKey, doc.key, true);

        // Act: `/mermaid` inserts a block that renders in the preview
        await editor.source.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/mermaid');
        await page
            .locator('.cm-tooltip-autocomplete li')
            .filter({ hasText: 'Mermaid diagram' })
            .click();

        // Assert
        await expect(editor.preview.locator('figure.tk-mermaid svg')).toContainText('Start');

        // Act: the Diagram button picks an existing diagram to embed
        await page.getByTestId('doc-editor-tool-diagram').click();
        await page.getByTestId('insert-diagram-search').fill('deploy');
        await page.getByTestId(`insert-diagram-row-${diagram.key}`).click();

        // Assert
        await expect(editor.source).toContainText(`![Deployment](${diagram.key})`);

        // Act: publish and close
        await editor.publish();
        await editor.expectStatus('Published v2');
        await page.keyboard.press('Escape');

        // Assert: the reader draws the embedded diagram and the inline block
        const embed = editor.content.locator(`figure.tk-doc-embed[data-doc-key="${diagram.key}"]`);
        await expect(embed.locator('.tk-doc-embed-body svg')).toContainText('Ticketing API');
        await expect(editor.content.locator('figure.tk-mermaid svg')).toContainText('Start');
    });
});
