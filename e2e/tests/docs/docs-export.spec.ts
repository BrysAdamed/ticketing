import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Download, Page } from '@playwright/test';
import { Api } from '../../support/api';
import { chainScene } from '../../support/canvas';
import { expect, test } from '../../support/fixtures';

interface Doc {
    key: string;
    title: string;
}

const SKETCH_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 120" width="420" height="120">' +
    '<rect width="420" height="120" fill="#ffffff"/>' +
    '<rect x="10" y="30" width="120" height="60" rx="8" fill="none" stroke="#1e1e1e" stroke-width="2"/>' +
    '<text x="70" y="65" text-anchor="middle" font-family="sans-serif" font-size="16">API</text>' +
    '<path d="M130 60 H290" stroke="#1e1e1e" stroke-width="2"/>' +
    '<rect x="290" y="30" width="120" height="60" rx="8" fill="none" stroke="#1e1e1e" stroke-width="2"/>' +
    '<text x="350" y="65" text-anchor="middle" font-family="sans-serif" font-size="16">DB</text></svg>';

/// A folder with a rich page (Mermaid, callout, table, code, a ticket chip, a Mermaid and a
/// Canvas embed) and a second page linking to it.
async function seedHandbook(api: Api) {
    const projectKey = (await api.createProject()).key;
    const ticket = await api.post<{ key: string }>(`/projects/${projectKey}/tickets`, {
        title: 'Charge the card',
        type: 'UserStory',
    });
    const folder = await api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Folder',
        title: 'Architecture',
    });
    const flow = await api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Diagram',
        diagramFormat: 'Mermaid',
        title: 'Checkout flow',
        parent: folder.key,
        content: 'flowchart LR\n  Shop[Shop] --> Ledger[(Ledger)]\n  Ledger --> Bank',
    });
    const sketch = await api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Diagram',
        diagramFormat: 'Canvas',
        title: 'Request path',
        parent: folder.key,
        content: chainScene('API', 'DB'),
        snapshot: SKETCH_SVG,
    });
    const rows = Array.from(
        { length: 12 },
        (_, i) => `| ${projectKey}-${i + 1} | Row ${i + 1} | ${i % 3 ? 'Open' : 'Done'} |`,
    );
    const page = await api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Page',
        title: 'Payment flow',
        parent: folder.key,
        content: [
            '## Overview',
            '',
            `Payments start in the shop; ${ticket.key} tracks card charges. Zażółć gęślą jaźń.`,
            '',
            '> [!NOTE]',
            '> The PDF is rendered offline by the API.',
            '',
            '```mermaid',
            'sequenceDiagram',
            '  actor U as User',
            '  U->>API: GET export.pdf',
            '  API->>Gotenberg: POST bundle',
            '  Gotenberg-->>API: PDF',
            '```',
            '',
            `![The checkout](${flow.key})`,
            '',
            `![API and database](${sketch.key})`,
            '',
            '## Table',
            '',
            '| Key | Title | Status |',
            '| --- | --- | --- |',
            ...rows,
            '',
            '## Code',
            '',
            '```ts',
            'export async function charge(card: Card): Promise<Receipt> {',
            "  return api.post('/charges', card);",
            '}',
            '```',
        ].join('\n'),
    });
    const notes = await api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Page',
        title: 'Release notes',
        parent: folder.key,
        content: `## 2.0\n\nSee [the payment flow](${page.key}) for the details.`,
    });
    return { projectKey, folder, page, notes, flow, sketch };
}

async function pdfOf(download: Download, name: string): Promise<Buffer> {
    const out = process.env.E2E_PDF_OUT;
    const path = await download.path();
    if (out) {
        await mkdir(out, { recursive: true });
        await copyFile(path, join(out, name));
    }
    return readFile(path);
}

async function openDoc(page: Page, projectKey: string, doc: Doc) {
    await page.goto(`/projects/${projectKey}/docs/${doc.key}`);
    await expect(page.getByTestId('doc-bar')).toBeVisible();
}

test.describe('PDF export', () => {
    test('Export PDF in the page bar downloads the page as a PDF', async ({ page, api }) => {
        // Arrange
        const { projectKey, page: doc } = await seedHandbook(api);
        await openDoc(page, projectKey, doc);

        // Act
        const downloading = page.waitForEvent('download', { timeout: 60_000 });
        await page.getByTestId('doc-export-pdf').click();
        const download = await downloading;

        // Assert
        expect(download.suggestedFilename()).toMatch(
            new RegExp(`^${projectKey}-Payment flow-\\d{4}-\\d{2}-\\d{2}\\.pdf$`),
        );
        const pdf = await pdfOf(download, 'page-light.pdf');
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
        await expect(page.getByText(/^Downloaded /)).toBeVisible();
    });

    test('Ctrl+P from dark mode exports the same light PDF', async ({ page, api }) => {
        // Arrange
        await page.emulateMedia({ colorScheme: 'dark' });
        const { projectKey, page: doc } = await seedHandbook(api);
        await openDoc(page, projectKey, doc);
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        // Act
        const downloading = page.waitForEvent('download', { timeout: 60_000 });
        await page.locator('body').press('ControlOrMeta+p');
        const download = await downloading;

        // Assert
        const pdf = await pdfOf(download, 'page-from-dark.pdf');
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    });

    test('A folder exports in the background from the tree menu and offers the download when ready', async ({
        page,
        api,
    }) => {
        // Arrange
        const { projectKey, folder, page: doc } = await seedHandbook(api);
        await openDoc(page, projectKey, doc);

        // Act
        await page.getByTestId(`doc-row-${folder.key}`).click({ button: 'right' });
        await page.getByTestId('doc-menu-export-pdf').click();
        await expect(page.getByText(/You can keep working/)).toBeVisible();
        const downloading = page.waitForEvent('download', { timeout: 120_000 });
        await page.getByRole('button', { name: 'Download' }).click({ timeout: 120_000 });
        const download = await downloading;

        // Assert
        expect(download.suggestedFilename()).toMatch(new RegExp(`^${projectKey}-Architecture-`));
        const pdf = await pdfOf(download, 'folder.pdf');
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    });

    test('A diagram exports on its own', async ({ page, api }) => {
        // Arrange
        const { projectKey, flow } = await seedHandbook(api);
        await openDoc(page, projectKey, flow);

        // Act
        const downloading = page.waitForEvent('download', { timeout: 60_000 });
        await page.getByTestId('doc-export-pdf').click();
        const download = await downloading;

        // Assert
        const pdf = await pdfOf(download, 'diagram.pdf');
        expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    });
});
