import { Locator, Page } from '@playwright/test';
import { BACKLOG_TOUR } from '@onboarding/tours/backlog.tours';
import { DASHBOARD_TOUR } from '@onboarding/tours/dashboard.tours';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

/// An empty private project and a fresh user with the given role in it (one user per test keeps
/// set-password under its rate limit).
async function seedEmptyProject(api: Api, role: 'Member' | 'Viewer') {
    const project = await api.createProject();
    const user = await seedUser(api, `empty-${role.toLowerCase()}`);
    await api.post(`/projects/${project.key}/members`, { user: user.id, role });
    return { key: project.key, credentials: { email: user.email, password: PASSWORD } };
}

function emptyState(page: Page, title: string): Locator {
    return page
        .locator('tk-empty-state')
        .filter({ has: page.getByRole('heading', { name: title }) });
}

function learnAction(state: Locator): Locator {
    return state.getByTestId('empty-state-learn');
}

test.describe('empty states with a learn action', () => {
    test('the backlog empty state starts the backlog tour and no longer mentions Jira', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedEmptyProject(api, 'Member');
        const { context, page } = await signInAs(browser, seeded.credentials);
        await page.goto(`/projects/${seeded.key}/backlog`);
        const state = emptyState(page, 'No tickets in backlog');
        await expect(state).toBeVisible();
        await expect(state).not.toContainText(/jira/i);
        await expect(state.getByRole('button', { name: /New ticket/ })).toBeVisible();

        // Act
        await learnAction(state).click();

        // Assert
        const popover = page.getByTestId('tour-popover');
        await expect(popover).toBeVisible();
        await expect(popover.getByTestId('tour-step-count')).toHaveText(
            new RegExp(`^${BACKLOG_TOUR.title} tour · Step 1 of \\d+$`),
        );
        await page.keyboard.press('Escape');
        await expect(popover).toHaveCount(0);
        await context.close();
    });

    test('a Viewer sees the learn action but no create action', async ({ browser, api }) => {
        // Arrange
        const seeded = await seedEmptyProject(api, 'Viewer');
        const { context, page } = await signInAs(browser, seeded.credentials);
        const pages = [
            {
                path: 'backlog',
                title: 'No tickets in backlog',
                learn: 'Take the tour',
                create: /New ticket/,
            },
            {
                path: 'test-cases',
                title: 'No test cases yet',
                learn: 'Take the tour',
                create: /New test case/,
            },
            {
                path: 'regressions',
                title: 'No regression sessions',
                learn: 'How regressions work',
                create: /Start regression/,
            },
            {
                path: 'dashboard',
                title: 'Nothing to chart yet',
                learn: 'Take the tour',
                create: /New ticket/,
            },
        ];

        for (const { path, title, learn, create } of pages) {
            // Act
            await page.goto(`/projects/${seeded.key}/${path}`);

            // Assert
            const state = emptyState(page, title);
            await expect(state, path).toBeVisible();
            await expect(learnAction(state), path).toHaveText(learn);
            await expect(state.getByRole('button', { name: create }), path).toHaveCount(0);
        }
        await context.close();
    });

    test('the regressions explainer opens and closes from the keyboard', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedEmptyProject(api, 'Member');
        const { context, page } = await signInAs(browser, seeded.credentials);
        await page.goto(`/projects/${seeded.key}/regressions`);
        const learn = learnAction(emptyState(page, 'No regression sessions'));
        await expect(learn).toHaveText('How regressions work');
        const dialog = page.getByRole('dialog', { name: 'How regressions work' });

        // Act: open with Enter, close with Escape
        await learn.focus();
        await page.keyboard.press('Enter');

        // Assert
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(dialog.getByRole('listitem')).toHaveCount(4);
        await expect(dialog.getByRole('button', { name: 'Got it' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(learn).toBeFocused();

        // Act: open with Space, close with Got it (Enter)
        await page.keyboard.press('Space');
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Enter');

        // Assert
        await expect(dialog).toHaveCount(0);
        await expect(learn).toBeFocused();
        await context.close();
    });

    test('the dashboard empty state starts the dashboard tour', async ({ browser, api }) => {
        // Arrange
        const seeded = await seedEmptyProject(api, 'Member');
        const { context, page } = await signInAs(browser, seeded.credentials);
        await page.goto(`/projects/${seeded.key}/dashboard`);
        const state = page.getByTestId('dashboard-empty');
        await expect(state).toBeVisible();

        // Act
        await learnAction(state).click();

        // Assert
        const popover = page.getByTestId('tour-popover');
        await expect(popover).toBeVisible();
        await expect(popover.getByTestId('tour-step-count')).toHaveText(
            `${DASHBOARD_TOUR.title} tour · Step 1 of ${DASHBOARD_TOUR.steps.length}`,
        );
        await expect(popover.getByRole('heading')).toHaveText(DASHBOARD_TOUR.steps[0].title);
        await context.close();
    });
});
