import { Browser, BrowserContext } from '@playwright/test';
import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides';
import { CHECKLIST_GUIDE } from '@onboarding/guides/checklist';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { markGuidesSeen, xsrfToken } from '../../support/guides';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

/// Signs a fresh Member of a new project in with every auto-shown guide seen except the
/// getting-started card, so My work shows it.
async function freshMember(browser: Browser, api: Api) {
    const user = await seedUser(api, 'checklist');
    const project = await api.createProject();
    await api.post(`/projects/${project.key}/members`, { user: user.email, role: 'Member' });
    const session = await signInAs(
        browser,
        { email: user.email, password: PASSWORD },
        { keepGuides: true },
    );
    await markGuidesSeen(
        session.context.request,
        AUTO_SHOWN_GUIDES.filter((g) => g.id !== CHECKLIST_GUIDE.id),
    );
    return { ...session, projectKey: project.key };
}

async function createTicketAs(context: BrowserContext, projectKey: string): Promise<void> {
    const response = await context.request.post(`/api/v1/projects/${projectKey}/tickets`, {
        data: { title: 'My first ticket', type: 'Technical' },
        headers: { 'X-XSRF-TOKEN': await xsrfToken(context.request) },
    });
    expect(response.ok(), await response.text()).toBe(true);
}

test.describe('Getting-started checklist', () => {
    test('Create a ticket ticks itself off on My work after a ticket is created through the API', async ({
        browser,
        api,
    }) => {
        // Arrange
        const { context, page, projectKey } = await freshMember(browser, api);
        await page.goto('/my-work');
        const card = page.getByTestId('checklist-card');
        const item = page.getByTestId('checklist-item-create-ticket');
        await expect(card).toBeVisible();
        await expect(item).toHaveAttribute('data-done', 'false');
        await expect(page.getByTestId('checklist-progress')).toHaveText('0 of 4');

        // Act
        await createTicketAs(context, projectKey);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));

        // Assert
        await expect(item).toHaveAttribute('data-done', 'true');
        await expect(page.getByTestId('checklist-progress')).toHaveText('2 of 4');
        await context.close();
    });

    test('Dismiss hides the card for good and Help → Getting started brings it back', async ({
        browser,
        api,
    }) => {
        // Arrange
        const { context, page } = await freshMember(browser, api);
        const shell = new ShellPage(page);
        await page.goto('/my-work');
        const card = page.getByTestId('checklist-card');
        await expect(card).toBeVisible();

        // Act
        await page.getByTestId('checklist-dismiss').click();
        await expect(card).toBeHidden();
        await page.reload();
        await expect(page.getByTestId('view-my-work.list')).toBeVisible();

        // Assert
        await expect(card).toBeHidden();

        // Act
        await page.goto('/projects');
        await shell.openHelp();
        await expect(shell.helpItem('help-getting-started')).toContainText('0 of 4');
        await shell.helpItem('help-getting-started').click();

        // Assert
        await expect(page).toHaveURL(/\/my-work$/);
        await expect(card).toBeVisible();
        await expect(page.locator('#checklist-title')).toBeFocused();
        await page.reload();
        await expect(card).toBeVisible();
        await context.close();
    });
});
