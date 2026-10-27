import { DocPagePage } from '../../pages/doc-page.page';
import { expect, test } from '../../support/fixtures';

interface Doc {
    key: string;
    title: string;
}

test.describe('doc comments', () => {
    test('add, edit and delete a comment below a page; the meta line counts them', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await api.post<Doc>(`/projects/${projectKey}/docs`, {
            kind: 'Page',
            title: 'Release plan',
            content: '# Release plan\n\nShip on Friday.',
        });
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key);
        await expect(view.comments.getByTestId('doc-comments-empty')).toBeVisible();

        // Act: add
        await view.comment('Friday is a **holiday**.');

        // Assert
        const card = view.commentCards().first();
        await expect(card.locator('strong')).toHaveText('holiday');
        await expect(view.metaComments).toHaveText('1 comment');
        await expect(card).not.toHaveAttribute('aria-busy', 'true');

        // Act: edit
        await card.hover();
        await card.getByTestId('doc-comment-edit').click();
        await card.getByRole('textbox').fill('Friday is a holiday, ship on Thursday.');
        await card.getByTestId('doc-comment-save').click();

        // Assert
        await expect(card.locator('tk-markdown')).toHaveText(
            'Friday is a holiday, ship on Thursday.',
        );
        await expect(card.getByTestId('doc-comment-edited')).toBeVisible();
        await expect
            .poll(
                async () =>
                    (await api.get<{ items: { body: string }[] }>(`/docs/${doc.key}/comments`))
                        .items[0].body,
            )
            .toBe('Friday is a holiday, ship on Thursday.');

        // Act: delete
        await card.hover();
        await card.getByTestId('doc-comment-delete').click();
        await page.getByTestId('confirm-ok').click();

        // Assert
        await expect(card).toContainText('Comment deleted');
        await expect(view.metaComments).toHaveCount(0);
        await page.reload();
        await expect(view.commentCards().first()).toContainText('Comment deleted');
    });

    test('Shift+C focuses the composer and diagrams have a thread too', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const diagram = await api.post<Doc>(`/projects/${projectKey}/docs`, {
            kind: 'Diagram',
            diagramFormat: 'Mermaid',
            title: 'Flow',
            content: 'flowchart LR\n  a --> b',
        });
        await api.post(`/docs/${diagram.key}/comments`, { body: 'Arrow a → b is wrong' });
        const view = new DocPagePage(page);
        await page.goto(`/projects/${projectKey}/docs/${diagram.key}`);

        // Act
        await expect(view.commentCards()).toHaveCount(1);
        await page.locator('body').press('Shift+C');

        // Assert
        await expect(view.commentComposer).toBeFocused();
        await expect(view.commentCards().first()).toContainText('Arrow a → b is wrong');
        await expect(page.getByTestId('doc-attachments')).toHaveCount(0);
    });
});
