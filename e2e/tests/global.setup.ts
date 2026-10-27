import { expect, test as setup } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ShellPage } from '../pages/shell.page';
import { ADMIN, ADMIN_STORAGE_STATE } from '../support/env';

setup('sign in as the bootstrap admin', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn(ADMIN.email, ADMIN.password);

    await new ShellPage(page).expectVisible();
    await expect(page).toHaveURL(/\/my-work$/);
    await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
