import { Route } from '@playwright/test';
import { RegressionsPage } from '../../pages/testing.page';
import { expect, test } from '../../support/fixtures';

interface Session {
    items: { testCaseKey: string; status: string }[];
}

test.describe('regression results', () => {
    test('apply at once, move on without waiting for the server, and roll back on failure', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject({ visibility: 'Public' });
        for (const title of ['First check', 'Second check', 'Third check']) {
            await api.post(`/projects/${project.key}/test-cases`, {
                title,
                status: 'Manual',
                steps: ['Do it'],
            });
        }
        await api.post(`/projects/${project.key}/regression-sessions`, { name: 'Smoke' });
        const sessionKey = `${project.key}-R-1`;
        const [one, two, three] = [1, 2, 3].map((n) => `${project.key}-TC-${n}`);
        const held: Route[] = [];
        await page.route('**/api/v1/regression-sessions/*/items/*/result', (route) => {
            held.push(route);
        });
        const regressions = new RegressionsPage(page);
        await page.goto(`/projects/${project.key}/regressions/${sessionKey}`);
        await expect(regressions.item(one)).toHaveAttribute('aria-current', 'true');

        // Act: pass twice while the server holds both answers
        await page.keyboard.press('p');
        await expect(regressions.item(two)).toHaveAttribute('aria-current', 'true');
        await page.keyboard.press('p');

        // Assert: both results show and the progress moved before any answer
        await expect(regressions.item(three)).toHaveAttribute('aria-current', 'true');
        await expect(page.getByTestId('summary-waiting')).toHaveText('1');
        await expect(regressions.item(one)).toHaveAttribute('aria-busy', 'true');
        await expect(page.getByTestId('session-complete')).toBeDisabled();
        expect(held).toHaveLength(2);

        // Act: the server accepts the first and rejects the second
        await held[0].continue();
        await held[1].fulfill({
            status: 500,
            contentType: 'application/problem+json',
            body: JSON.stringify({ title: 'Something went wrong.', status: 500 }),
        });

        // Assert: the second item is back to waiting with a toast naming it
        await expect(page.getByTestId('toast').filter({ hasText: two })).toBeVisible();
        await expect(page.getByTestId('summary-waiting')).toHaveText('2');
        await expect(regressions.item(one)).not.toHaveAttribute('aria-busy', 'true');
        await expect(page.getByTestId('session-complete')).toBeEnabled();
        await expect(page.getByTestId('session-complete')).toContainText('skip 2 waiting');
        const session = await api.get<Session>(`/regression-sessions/${sessionKey}`);
        expect(session.items.map((i) => i.status)).toEqual([
            'Passed',
            'WaitingForExecution',
            'WaitingForExecution',
        ]);
    });
});
