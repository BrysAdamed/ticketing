import { DocPagePage } from '../../pages/doc-page.page';
import { expect, test } from '../../support/fixtures';
import { seedUser } from '../identity/identity';

interface Doc {
    key: string;
}

interface Watchers {
    count: number;
    watching: boolean;
}

test.describe('watch docs', () => {
    test('the creator watches a new page and can unwatch and watch again with the button and W', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await api.post<Doc>(`/projects/${projectKey}/docs`, {
            kind: 'Page',
            title: 'Runbook',
            content: '# Runbook',
        });
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key);
        const toggle = page.getByTestId('doc-watch-toggle');
        const count = page.getByTestId('doc-watchers-count');

        // Assert: creators watch the pages they create
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(count).toHaveAttribute('aria-label', '1 watcher');

        // Act: unwatch with the button
        await toggle.click();

        // Assert
        await expect(toggle).toHaveText('Watch');
        await expect(count).toHaveAttribute('aria-label', '0 watchers');
        await expect
            .poll(async () => (await api.get<Watchers>(`/docs/${doc.key}/watchers`)).watching)
            .toBe(false);

        // Act: watch again with W
        await page.locator('body').press('w');

        // Assert
        await expect(toggle).toHaveText('Watching');
        await expect
            .poll(async () => (await api.get<Watchers>(`/docs/${doc.key}/watchers`)).count)
            .toBe(1);
        await count.click();
        await expect(page.getByTestId('doc-watchers')).toContainText('you');
    });

    test('picking a reader with @ in a doc comment shows a chip and makes them watch the page', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const doc = await api.post<Doc>(`/projects/${projectKey}/docs`, {
            kind: 'Page',
            title: 'Rollout',
            content: '# Rollout',
        });
        const reader = await seedUser(api, 'docmention');
        const view = new DocPagePage(page);
        await view.goto(projectKey, doc.key);

        // Act
        await view.commentComposer.click();
        await view.commentComposer.pressSequentially(
            `Please review @${reader.email.split('@')[0]}`,
        );
        await expect(
            page.getByTestId('mention-picker').getByTestId(`mention-option-${reader.email}`),
        ).toHaveAttribute('aria-selected', 'true');
        await view.commentComposer.press('Enter');
        await view.commentComposer.press('ControlOrMeta+Enter');

        // Assert
        await expect(view.commentCards().first().getByTestId(`mention-${reader.id}`)).toHaveText(
            new RegExp(`${reader.displayName}$`),
        );
        await expect
            .poll(async () =>
                (
                    await api.get<Watchers & { users: { id: string }[] }>(
                        `/docs/${doc.key}/watchers`,
                    )
                ).users.map((u) => u.id),
            )
            .toContain(reader.id);
    });
});
