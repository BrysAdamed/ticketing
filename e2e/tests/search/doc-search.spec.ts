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
});
