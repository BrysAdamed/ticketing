import { BacklogPage } from '../../pages/backlog.page';
import { RegressionsPage, TestCasesPage } from '../../pages/testing.page';
import { expect, test } from '../../support/fixtures';

interface Ticket {
    key: string;
    title: string;
    type: string;
    severity: string | null;
    priority: string;
    version: string | null;
    labels: string[];
    description: string | null;
    links: { type: string; ticket: { key: string } }[] | null;
}

interface Session {
    status: string;
    items: {
        testCaseKey: string;
        status: string;
        resultNote: string | null;
        bug: { key: string } | null;
    }[];
}

test.describe('test cases and regressions', () => {
    test('write cases, run a regression, fail an item into a bug, complete with skip remaining', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject({ visibility: 'Public' });
        const story = await api.post<{ key: string }>(`/projects/${project.key}/tickets`, {
            title: 'Sign-in page',
            type: 'UserStory',
        });
        const testCases = new TestCasesPage(page);
        const regressions = new RegressionsPage(page);
        await testCases.goto(project.key);

        // Act: write a manual and an automatic case, plus one more manual case that stays waiting
        const manual = await testCases.create({
            title: 'Log in with valid credentials',
            status: 'Manual',
            steps: ['Open the login page', 'Submit valid credentials'],
        });
        await testCases.linkTicket(story.key);
        const automatic = await testCases.create({
            title: 'API health check',
            status: 'Automatic',
            automation: 'tests/health.spec.ts',
        });
        const waiting = await testCases.create({
            title: 'Export the report',
            status: 'Manual',
            steps: ['Click export'],
        });
        await expect(testCases.row(manual)).toBeVisible();
        await expect(testCases.statusTab('Manual')).toContainText('2');

        // Act: start a session
        await regressions.goto(project.key);
        await regressions.start('1.4.0');

        // Assert: automatic case auto-passed, manual cases waiting
        await expect(regressions.item(automatic)).toBeVisible();
        await regressions.focus(automatic);
        await expect(regressions.pane.getByTestId('item-status')).toHaveText(/Auto-passed/);

        // Act: take the manual item and fail it with a note, creating the bug from the pre-filled dialog
        await regressions.focus(manual);
        await regressions.pane.getByTestId('item-take').click();
        await expect(regressions.pane.getByTestId('item-assignee')).not.toContainText('Unassigned');
        await page.keyboard.press('f');
        await page
            .getByTestId('fail-note')
            .locator('textarea')
            .fill('The sign-in button does nothing');
        await page.getByTestId('fail-confirm').click();
        const dialog = page.locator('mat-dialog-container');
        await expect(dialog.getByTestId('create-title')).toHaveValue(
            '[Regression] Log in with valid credentials',
        );
        await dialog.getByTestId('create-submit').click();
        await expect(dialog).toBeHidden();

        // Assert: the item links its bug; the bug is at the top of the backlog with repro steps
        await regressions.focus(manual);
        const bugChip = regressions.pane.getByTestId('item-bug');
        await expect(bugChip).toBeVisible();
        const bugKey = (await bugChip.locator('.tnum').textContent())!.trim();
        const bug = await api.get<Ticket>(`/tickets/${bugKey}`);
        expect([bug.type, bug.severity, bug.priority, bug.version, bug.labels]).toEqual([
            'Bug',
            'Major',
            'High',
            '1.4.0',
            ['regression'],
        ]);
        expect(bug.description).toContain(
            '## Steps to reproduce\n1. Open the login page\n2. Submit valid credentials',
        );
        expect(bug.description).toContain('## Actual result\nThe sign-in button does nothing');
        expect(bug.links?.map((l) => [l.type, l.ticket.key])).toEqual([['RelatesTo', story.key]]);
        const backlog = new BacklogPage(page);
        await backlog.goto(project.key);
        await expect(backlog.row(bugKey)).toBeVisible();
        expect((await backlog.keys())[0]).toBe(bugKey);

        // Act: complete, skipping the remaining waiting item
        await page.goBack();
        await expect(regressions.session).toBeVisible();
        await page.getByTestId('session-complete').click();
        await page.getByTestId('confirm-ok').click();

        // Assert: completed, read-only, the waiting item skipped
        await expect(page.getByTestId('session-status')).toContainText('Completed');
        await expect(page.getByTestId('session-readonly')).toBeVisible();
        await expect(page.getByTestId('item-actions')).toHaveCount(0);
        const session = await api.get<Session>(`/regression-sessions/${project.key}-R-1`);
        expect(session.status).toBe('Completed');
        const skipped = session.items.find((i) => i.testCaseKey === waiting)!;
        expect([skipped.status, skipped.resultNote]).toEqual(['Skipped', 'Skipped at completion']);
    });

    test('pass with the keyboard, filter mine, and see results on the test case', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject({ visibility: 'Public' });
        for (const title of ['First check', 'Second check']) {
            await api.post(`/projects/${project.key}/test-cases`, {
                title,
                status: 'Manual',
                steps: ['Do it'],
            });
        }
        await api.post(`/projects/${project.key}/regression-sessions`, { name: 'Smoke' });
        const regressions = new RegressionsPage(page);
        await page.goto(`/projects/${project.key}/regressions/${project.key}-R-1`);
        await expect(regressions.session).toBeVisible();

        // Act: p passes the focused item and moves on to the next waiting one; s skips it
        await expect(regressions.item(`${project.key}-TC-1`)).toHaveAttribute(
            'aria-current',
            'true',
        );
        await page.keyboard.press('p');
        await expect(regressions.item(`${project.key}-TC-2`)).toHaveAttribute(
            'aria-current',
            'true',
        );
        await page.keyboard.press('s');
        await page.getByTestId('item-filter-mine').click();

        // Assert
        await expect(page.getByTestId('summary-waiting')).toHaveText('0');
        await expect(page.getByTestId('summary-pass-rate')).toHaveText('100%');
        await expect(page.getByTestId('session-items').getByRole('button')).toHaveCount(2);
        const testCases = new TestCasesPage(page);
        await testCases.goto(project.key);
        await testCases.row(`${project.key}-TC-1`).click();
        await expect(testCases.editor.getByTestId('tc-runs')).toContainText(`${project.key}-R-1`);
        await expect(testCases.editor.getByTestId('tc-runs')).toContainText('Passed');
    });

    test('archive hides a case from the list and from new sessions', async ({ page, api }) => {
        // Arrange
        const project = await api.createProject({ visibility: 'Public' });
        await api.post(`/projects/${project.key}/test-cases`, {
            title: 'Keep me',
            status: 'Automatic',
        });
        await api.post(`/projects/${project.key}/test-cases`, {
            title: 'Retire me',
            status: 'Automatic',
        });
        const testCases = new TestCasesPage(page);
        await testCases.goto(project.key);

        // Act
        await testCases.row(`${project.key}-TC-2`).click();
        await testCases.editor.getByTestId('tc-editor-menu').click();
        await page.getByTestId('tc-archive').click();

        // Assert
        await expect(testCases.editor.getByTestId('tc-editor-archived')).toBeVisible();
        await expect(testCases.row(`${project.key}-TC-2`)).toHaveCount(0);
        await page.getByTestId('tc-archived').click();
        await expect(testCases.row(`${project.key}-TC-2`)).toBeVisible();
        const session = await api.post<Session>(`/projects/${project.key}/regression-sessions`, {});
        expect(session.items.map((i) => i.testCaseKey)).toEqual([`${project.key}-TC-1`]);
    });
});
