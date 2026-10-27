import { TestCasesPage } from '../../pages/testing.page';
import { expect, test } from '../../support/fixtures';

interface TestCase {
    title: string;
    steps: string[];
    expectedResult: string | null;
}

test.describe('test case editor autosave', () => {
    test('saves edits without a Save button and keeps them when switching cases', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject({ visibility: 'Public' });
        for (const title of ['Log in', 'Log out']) {
            await api.post(`/projects/${project.key}/test-cases`, {
                title,
                status: 'Manual',
                steps: ['Open the page'],
            });
        }
        const first = `${project.key}-TC-1`;
        const second = `${project.key}-TC-2`;
        const testCases = new TestCasesPage(page);
        await testCases.goto(project.key);
        await testCases.row(first).click();

        // Act: edit, then leave the field (blur saves)
        await testCases.editor.getByTestId('tc-title').fill('Log in with SSO');
        await testCases.editor.getByTestId('step-input-0').click();

        // Assert
        await testCases.expectSaved();
        await expect(testCases.row(first)).toContainText('Log in with SSO');
        await expect(testCases.editor.getByTestId('tc-save')).toHaveCount(0);

        // Act: type a step and switch to another case before the debounce fires
        await testCases.editor.getByTestId('step-input-0').fill('Open the SSO page');
        await testCases.row(second).click();

        // Assert: the edit was saved on the way out
        await expect(testCases.editor.getByTestId('tc-editor-key')).toHaveText(second);
        await expect
            .poll(async () => (await api.get<TestCase>(`/test-cases/${first}`)).steps)
            .toEqual(['Open the SSO page']);
    });

    test('keeps edits that cannot be saved as a draft and restores them', async ({ page, api }) => {
        // Arrange
        const project = await api.createProject({ visibility: 'Public' });
        for (const title of ['Export the report', 'Import a file']) {
            await api.post(`/projects/${project.key}/test-cases`, {
                title,
                status: 'Manual',
                steps: ['Click export'],
            });
        }
        const first = `${project.key}-TC-1`;
        const testCases = new TestCasesPage(page);
        await testCases.goto(project.key);
        await testCases.row(first).click();

        // Act: clear the title (invalid) and change the expected result, then switch away
        await testCases.editor.getByTestId('tc-title').fill('');
        await testCases.editor
            .getByTestId('tc-expected')
            .locator('textarea')
            .fill('A CSV file downloads');
        await expect(testCases.saveState).toHaveAttribute('data-state', 'invalid');
        await testCases.row(`${project.key}-TC-2`).click();

        // Assert: nothing was saved, a toast offers to go back
        const toast = page.getByTestId('toast').filter({ hasText: first });
        await expect(toast).toContainText('draft');
        expect((await api.get<TestCase>(`/test-cases/${first}`)).expectedResult).toBeNull();

        // Act: go back and fix the title
        await toast.getByRole('button', { name: 'Open' }).click();
        await expect(testCases.editor.getByTestId('tc-draft-restored')).toBeVisible();
        await expect(
            testCases.editor.getByTestId('tc-expected').locator('textarea'),
        ).toHaveValue('A CSV file downloads');
        await testCases.editor.getByTestId('tc-title').fill('Export the report as CSV');

        // Assert: everything is saved and the draft notice goes away
        await testCases.expectSaved();
        await expect(testCases.editor.getByTestId('tc-draft-restored')).toHaveCount(0);
        const saved = await api.get<TestCase>(`/test-cases/${first}`);
        expect([saved.title, saved.expectedResult]).toEqual([
            'Export the report as CSV',
            'A CSV file downloads',
        ]);
    });
});
