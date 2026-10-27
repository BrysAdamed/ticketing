import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface DocRef {
    id: string;
    key: string;
    title: string;
}

function createPage(api: Api, projectKey: string, title: string, content: string): Promise<DocRef> {
    return api.post<DocRef>(`/projects/${projectKey}/docs`, { kind: 'Page', title, content });
}

test.describe('docs search and quick jump', () => {
    test('Ctrl+K lists matching docs with a snippet and opens one', async ({
        page,
        api,
        shell,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const word = `okapi${Date.now().toString(36)}`;
        const doc = await createPage(
            api,
            projectKey,
            'Webhook runbook',
            `Replaying events is safe because every handler of the ${word} queue is idempotent.`,
        );
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByTestId('command-palette-input').fill(word);
        const item = page.getByTestId(`palette-item-Doc:${doc.key}`);

        // Assert
        await expect(item).toBeVisible();
        await expect(item).toContainText('Webhook runbook');
        await expect(item.locator('mark')).toHaveText(word);
        await item.click();
        await expect(page).toHaveURL(new RegExp(`/docs/${doc.key}`));
    });

    test('Ctrl+K: typing a doc key jumps to the doc', async ({ page, api, shell }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(api, projectKey, 'Jump target', 'Body');
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act
        await page.keyboard.press('ControlOrMeta+k');
        const input = page.getByTestId('command-palette-input');
        await input.fill(doc.key.toLowerCase());
        await expect(page.getByTestId(`palette-item-jump:${doc.key}`)).toBeVisible();
        await input.press('Enter');

        // Assert
        await expect(page).toHaveURL(new RegExp(`/docs/${doc.key}`));
    });

    test('the search page switches to Docs, keeps its state in the URL and shows markup as text', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const word = `tapir${Date.now().toString(36)}`;
        const doc = await createPage(
            api,
            projectKey,
            `Release ${word}`,
            `Notes for ${word}: <img src=x onerror=alert(1)> stays text.`,
        );
        await api.post(`/projects/${projectKey}/docs`, {
            kind: 'Folder',
            title: `Archive ${word}`,
        });
        let dialogs = 0;
        page.on('dialog', () => dialogs++);
        await page.goto(`/search?q=${word}`);

        // Act
        await page.getByTestId('search-scope-docs').click();
        await expect(page).toHaveURL(/scope=docs/);
        const row = page.getByTestId(`doc-search-row-${doc.key}`);
        await expect(row).toBeVisible();
        await page.getByTestId('doc-filter-kind').click();
        await page.getByTestId('doc-filter-kind-Page').click();
        await page.keyboard.press('Escape');

        // Assert
        await expect(page).toHaveURL(/kind=Page/);
        await expect(page.getByTestId('doc-search-results').locator('a')).toHaveCount(1);
        await expect(row).toContainText('<img src=x onerror=alert(1)>');
        await expect(row.locator('img')).toHaveCount(0);
        expect(dialogs).toBe(0);
        const shared = page.url();
        await page.goto('about:blank');
        await page.goto(shared);
        await expect(page.getByTestId('doc-search-text')).toHaveValue(word);
        await expect(page.getByTestId(`doc-search-row-${doc.key}`)).toBeVisible();
        await expect(page.getByTestId('doc-filter-kind')).toContainText('Page');
    });

    test('Ctrl+K prefixes p: and t: narrow the results to docs or tickets', async ({
        page,
        api,
        shell,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const word = `quokka${Date.now().toString(36)}`;
        const ticket = await api.post<DocRef>(`/projects/${projectKey}/tickets`, {
            title: `Fix the ${word} export`,
            type: 'Bug',
        });
        const docs: DocRef[] = [];
        for (let i = 0; i < 7; i++)
            docs.push(await createPage(api, projectKey, `Guide ${i}`, `How the ${word} works.`));
        await page.goto('/my-work');
        await shell.expectVisible();
        await page.keyboard.press('ControlOrMeta+k');
        const input = page.getByTestId('command-palette-input');
        const palette = page.getByTestId('command-palette');

        // Act
        await input.fill(`p: ${word}`);

        // Assert
        await expect(palette.locator('[data-testid^="palette-item-Doc:"]')).toHaveCount(7);
        await expect(page.getByTestId(`palette-item-Ticket:${ticket.key}`)).toHaveCount(0);
        await expect(page.getByTestId('palette-item-search:docs')).toBeVisible();
        await expect(page.getByTestId('palette-item-search:open')).toHaveCount(0);
        await expect(page.getByTestId('palette-scope-docs')).toHaveClass(/active/);

        // Act
        await input.fill(`t: ${word}`);

        // Assert
        await expect(page.getByTestId(`palette-item-Ticket:${ticket.key}`)).toBeVisible();
        await expect(palette.locator('[data-testid^="palette-item-Doc:"]')).toHaveCount(0);
        await expect(page.getByTestId('palette-item-search:docs')).toHaveCount(0);
        await expect(page.getByTestId('command-palette-footer')).toContainText('docs only');
        await expect(page.getByTestId('command-palette-footer')).toContainText('tickets only');
    });

    test('Ctrl+K with an empty query lists recently viewed docs', async ({ page, api, shell }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createPage(api, projectKey, 'Recently read', 'Body');
        await page.goto(`/docs/${doc.key}`);
        await expect(page).toHaveURL(
            new RegExp(`/projects/${projectKey}/docs/${doc.key}/recently-read`),
        );
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act
        await page.keyboard.press('ControlOrMeta+k');
        const item = page.getByTestId(`palette-item-recent-doc:${doc.key}`);

        // Assert
        await expect(item).toBeVisible();
        await item.click();
        await expect(page).toHaveURL(
            new RegExp(`/projects/${projectKey}/docs/${doc.key}/recently-read`),
        );
    });
});
