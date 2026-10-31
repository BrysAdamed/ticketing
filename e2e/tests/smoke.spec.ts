import { expect, test } from '../support/fixtures';
import { ADMIN, BASE_URL } from '../support/env';

test.describe('anonymous', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('login, shell, theme toggle, logout', async ({ page, loginPage, shell }) => {
        // Arrange
        await page.goto('/projects');
        await expect(page).toHaveURL(/\/login\?returnUrl=%2Fprojects$/);

        // Act
        await loginPage.signIn(ADMIN.email, ADMIN.password);

        // Assert
        await expect(page).toHaveURL(/\/projects$/);
        await shell.expectVisible();
        await expect(shell.navLink('nav-admin-users')).toBeVisible();

        const before = await shell.theme();
        await shell.toggleTheme();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');
        await page.reload();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '');

        await shell.signOut();
        await expect(page).toHaveURL(/\/login/);
        await page.goto('/my-work');
        await expect(page).toHaveURL(/\/login\?returnUrl=%2Fmy-work$/);
    });

    test('a copied session cookie stops working after sign-out', async ({
        page,
        playwright,
        loginPage,
        shell,
    }) => {
        // Arrange
        await loginPage.goto();
        await loginPage.signIn(ADMIN.email, ADMIN.password);
        await shell.expectVisible();
        const copied = await page.context().storageState();

        // Act
        await shell.signOut();
        await expect(page).toHaveURL(/\/login/);
        const replay = await playwright.request.newContext({
            baseURL: BASE_URL,
            storageState: copied,
        });
        const me = await replay.get('/api/v1/me');

        // Assert
        expect(me.status()).toBe(401);
        await replay.dispose();
    });

    test('wrong password shows an error', async ({ loginPage }) => {
        // Arrange
        await loginPage.goto();

        // Act
        await loginPage.signIn(ADMIN.email, 'definitely-not-the-password');

        // Assert
        await expect(loginPage.error).toBeVisible();
    });
});

test.describe('signed in', () => {
    test('sidebar lists projects from the API', async ({ page, api, shell }) => {
        // Arrange
        const project = await api.createProject();

        // Act
        await page.goto('/my-work');

        // Assert
        await shell.expectVisible();
        await expect(shell.navLink('nav-all-projects')).toBeVisible();
        await page.goto('/projects');
        await page.getByTestId('projects-filter').fill(project.key);
        await expect(page.getByTestId(`project-row-${project.key}`)).toBeVisible();
    });

    test('command palette opens with Ctrl+K and jumps to a page', async ({ page, shell }) => {
        // Arrange
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act
        await page.keyboard.press('ControlOrMeta+k');
        await expect(shell.palette).toBeVisible();
        await page.getByTestId('command-palette-input').fill('boards');
        await page.keyboard.press('Enter');

        // Assert
        await expect(page).toHaveURL(/\/boards$/);
        await expect(shell.palette).toBeHidden();
    });
});
