import { DocHistoryPage } from '../../pages/doc-history.page';
import { DocPagePage } from '../../pages/doc-page.page';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { PASSWORD, seedUser } from '../identity/identity';

interface Doc {
    key: string;
    title: string;
    content: string | null;
    version: number;
}

const V1 =
    '# Payment flow\n\n## Sequence\n\nAPI calls Stripe: create charge\n\nSaving cards is out of scope.';
const V2 =
    '# Payment flow\n\n## Sequence\n\nAPI calls Stripe: create PaymentIntent\nStripe returns the client secret\n\nSaving cards is out of scope.';
const V3 = `${V2}\n\n## Failure handling\n\nRetry twice.`;

/// A page with three versions and a rename between v2 and v3.
async function pageWithHistory(api: Api, projectKey: string): Promise<Doc> {
    const doc = await api.post<Doc>(`/projects/${projectKey}/docs`, {
        kind: 'Page',
        title: 'Payment flow',
        content: V1,
    });
    await api.patch(`/docs/${doc.key}`, {
        content: V2,
        baseVersion: 1,
        changeNote: 'PaymentIntent',
    });
    await api.patch(`/docs/${doc.key}`, { title: 'Payments', content: V3, baseVersion: 2 });
    return doc;
}

test.describe('docs history', () => {
    test('compare versions, view an old one and restore it', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await pageWithHistory(api, projectKey);
        const reader = new DocPagePage(page);
        const history = new DocHistoryPage(page);
        await reader.goto(projectKey, doc.key);

        // Act: H opens the history on the changes of the current version
        await history.open();

        // Assert
        await expect(history.bar).toContainText('Changes in v3');
        await expect(history.version(3)).toContainText('Current');
        await expect(history.version(2)).toContainText('PaymentIntent');
        await expect(history.diff.locator('.dl.add')).toContainText(['## Failure handling']);
        await expect(history.titleChange).toContainText('Payment flow');

        // Act: select v1 (compared with current), then Shift+click v2 to compare v1 with v2
        await history.version(1).click();
        await expect(history.bar).toContainText('v1 → v3 · current');
        await history.version(2).click({ modifiers: ['Shift'] });

        // Assert: word highlights inside the changed line, side by side as well
        await expect(history.bar).toContainText('v1 → v2');
        await expect(history.diff.locator('del')).toHaveText(['charge']);
        await expect(history.diff.locator('ins').first()).toHaveText('PaymentIntent');
        await history.layout('split');
        await expect(history.diff).toHaveClass(/split/);
        await expect(history.diff.locator('.sr').filter({ hasText: 'charge' })).toContainText(
            'PaymentIntent',
        );
        await history.layout('unified');

        // Act: render v1 and restore it
        await history.version(1).click();
        await history.mode('rendered');
        await expect(page.getByTestId('doc-version-title')).toHaveText('Payment flow');
        await history.restoreButton.click();
        await history.confirmRestore();

        // Assert: v4 restores v1, nothing lost
        await expect(history.version(4)).toContainText('Restored from v1');
        await expect(history.version(4)).toContainText('Current');
        const restored = await api.get<Doc>(`/docs/${doc.key}`);
        expect([restored.version, restored.title, restored.content]).toEqual([
            4,
            'Payment flow',
            V1,
        ]);

        // Act: Esc closes the history
        await page.locator('body').press('Escape');

        // Assert
        await expect(history.panel).toBeHidden();
        await expect(reader.content).toContainText('create charge');
    });

    test('an old version renders with the banner and links back to the latest', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await pageWithHistory(api, projectKey);
        const history = new DocHistoryPage(page);

        // Act
        await page.goto(`/projects/${projectKey}/docs/${doc.key}?v=2`);

        // Assert
        await expect(history.versionBanner).toContainText('You are viewing v2 of 3');
        await expect(page.getByTestId('doc-version-content')).toContainText(
            'Stripe returns the client secret',
        );
        await expect(page.getByTestId('doc-version-meta')).toContainText('PaymentIntent');
        await expect(history.versionRestore).toBeVisible();

        // Act
        await history.versionBanner.getByRole('link', { name: 'Back to latest' }).click();

        // Assert
        await expect(history.versionView).toBeHidden();
        await expect(page.getByTestId('doc-content')).toContainText('Failure handling');
    });

    test('viewers browse the history but cannot restore', async ({ api, browser }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const doc = await pageWithHistory(api, projectKey);
        const viewer = await seedUser(api, 'viewer');
        await api.post(`/projects/${projectKey}/members`, { user: viewer.email, role: 'Viewer' });
        const context = await browser.newContext({
            storageState: { cookies: [], origins: [] },
            viewport: { width: 1440, height: 900 },
        });
        const viewerPage = await context.newPage();
        const login = new LoginPage(viewerPage);
        await login.goto();
        await login.signIn(viewer.email, PASSWORD);
        await new ShellPage(viewerPage).expectVisible();
        const history = new DocHistoryPage(viewerPage);

        // Act
        await viewerPage.goto(`/projects/${projectKey}/docs/${doc.key}?history=1`);

        // Assert
        await expect(history.bar).toContainText('v1 → v3 · current');
        await expect(history.restoreButton).toBeHidden();
        await viewerPage.goto(`/projects/${projectKey}/docs/${doc.key}?v=1`);
        await expect(history.versionBanner).toBeVisible();
        await expect(history.versionRestore).toBeHidden();
        await context.close();
    });
});
