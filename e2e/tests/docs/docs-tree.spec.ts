import { DocsPage } from '../../pages/docs.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface Doc {
    key: string;
    title: string;
    parentKey: string | null;
}

async function createDoc(
    api: Api,
    projectKey: string,
    body: { kind: 'Folder' | 'Page'; title: string; parent?: string; content?: string },
): Promise<Doc> {
    return api.post<Doc>(`/projects/${projectKey}/docs`, body);
}

test.describe('docs tree', () => {
    test('folder, page, drag into the folder, rename, delete and undo', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const docs = new DocsPage(page);
        await docs.goto(projectKey);
        await expect(page.getByTestId('docs-empty')).toBeVisible();

        // Act: a folder with the keyboard, then a page at the top level from the home
        await docs.create('Shift+N', 'Architecture');
        const folderKey = `${projectKey}-D-1`;
        await expect(docs.row(folderKey)).toBeVisible();
        await page.getByTestId('docs-new-page').click();
        await expect(docs.createInput).toBeFocused();
        await docs.createInput.fill('Payment flow');
        await docs.createInput.press('Enter');
        const pageKey = `${projectKey}-D-2`;
        await expect(page).toHaveURL(
            new RegExp(`/projects/${projectKey}/docs/${pageKey}/payment-flow$`),
        );
        await expect(page.getByTestId('doc-title')).toHaveText('Payment flow');

        // Act: drag the page into the folder
        const moved = page.waitForResponse(
            (r) => r.url().includes(`/docs/${pageKey}/move`) && r.request().method() === 'POST',
        );
        await docs.dragInto(pageKey, folderKey);

        // Assert: optimistic, then confirmed by the server
        await expect.poll(() => docs.outline()).toEqual(['Architecture', '  Payment flow']);
        expect((await moved).status()).toBe(200);
        expect((await api.get<Doc>(`/docs/${pageKey}`)).parentKey).toBe(folderKey);

        // Act: rename with F2
        await page.locator('body').press('F2');
        await expect(docs.renameInput).toBeFocused();
        await docs.renameInput.fill('Payment flows');
        await docs.renameInput.press('Enter');

        // Assert: title and slug follow
        await expect(docs.row(pageKey)).toContainText('Payment flows');
        await expect(page).toHaveURL(new RegExp(`/${pageKey}/payment-flows$`));
        await expect
            .poll(async () => (await api.get<Doc>(`/docs/${pageKey}`)).title)
            .toBe('Payment flows');

        // Act: delete with Del, then Undo
        await page.locator('body').press('Delete');
        await expect(docs.row(pageKey)).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`/docs/${folderKey}/architecture$`));
        const toast = page.getByTestId('toast');
        await expect(toast).toContainText('Deleted "Payment flows"');
        await toast.getByRole('button', { name: 'Undo' }).click();

        // Assert
        await expect(docs.row(pageKey)).toBeVisible();
        await expect(page.getByTestId('toast')).toContainText('Restored "Payment flows"');
        expect((await api.get<Doc>(`/docs/${pageKey}`)).parentKey).toBe(folderKey);
    });

    test('a doc link without the slug, and the short /docs/KEY link, open the canonical URL', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await createDoc(api, projectKey, {
            kind: 'Page',
            title: 'Release notes 2.4',
            content: '# Hello',
        });

        // Act
        await page.goto(`/docs/${doc.key.toLowerCase()}`);

        // Assert
        await expect(page).toHaveURL(
            new RegExp(`/projects/${projectKey}/docs/${doc.key}/release-notes-2-4$`),
        );
        await expect(page.getByTestId('doc-title')).toHaveText('Release notes 2.4');
        await expect(new DocsPage(page).row(doc.key)).toHaveClass(/active/);
    });

    test('Move to… refuses a title clash, and the filter keeps the ancestors of matches', async ({
        page,
        api,
    }) => {
        // Arrange: a folder already holding "Runbook", and another "Runbook" at the top level
        const projectKey = (await api.createProject()).key;
        const folder = await createDoc(api, projectKey, { kind: 'Folder', title: 'Ops' });
        await createDoc(api, projectKey, { kind: 'Page', title: 'Runbook', parent: folder.key });
        const loose = await createDoc(api, projectKey, { kind: 'Page', title: 'runbook' });
        const docs = new DocsPage(page);
        await docs.goto(projectKey);

        // Act: the title clash is refused before any request
        await docs.openMenu(loose.key);
        await page.getByTestId('doc-menu-move').click();
        const option = page.getByTestId('inline-picker').getByRole('option', { name: 'Ops' });

        // Assert
        await expect(option).toHaveAttribute('aria-disabled', 'true');
        await page.keyboard.press('Escape');

        // Act: filter
        await docs.filter.fill('runb');

        // Assert
        await expect.poll(() => docs.outline()).toEqual(['Ops', '  Runbook', 'runbook']);
    });

    test('owners see the trash and restore from it', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const folder = await createDoc(api, projectKey, { kind: 'Folder', title: 'Old notes' });
        await createDoc(api, projectKey, { kind: 'Page', title: 'Minutes', parent: folder.key });
        await api.delete(`/docs/${folder.key}`);
        const docs = new DocsPage(page);
        await docs.goto(projectKey);

        // Act
        await page.getByTestId('doc-tree-trash').click();
        await expect(page.getByTestId(`docs-trash-row-${folder.key}`)).toContainText('+1');
        await page.getByTestId(`docs-trash-restore-${folder.key}`).click();

        // Assert
        await expect(page.getByTestId('docs-trash-empty')).toBeVisible();
        await expect(docs.row(folder.key)).toBeVisible();
    });
});
