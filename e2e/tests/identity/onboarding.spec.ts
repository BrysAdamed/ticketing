import { AdminUsersPage, SetPasswordPage } from '../../pages/identity.page';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { expect, test } from '../../support/fixtures';
import { markGuidesSeenAs } from '../../support/guides';
import { PASSWORD, uniqueEmail } from './identity';

test('admin creates a user, the user sets a password through the link and signs in', async ({
    page,
    browser,
}) => {
    // Arrange
    const email = uniqueEmail('onboard');
    const users = new AdminUsersPage(page);
    await users.goto();

    // Act
    const link = await users.createUser(email, 'Onboarding Olivia');
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const newcomer = await anonymous.newPage();
    await newcomer.goto(link);
    const setPassword = new SetPasswordPage(newcomer);
    await expect(setPassword.email).toHaveText(email);
    await setPassword.setPassword(PASSWORD);
    await markGuidesSeenAs({ email, password: PASSWORD });
    await setPassword.signIn.click();
    await new LoginPage(newcomer).signIn(email, PASSWORD);

    // Assert
    await new ShellPage(newcomer).expectVisible();
    await expect(users.row(email)).toBeVisible();
    await expect(page.getByTestId(`user-status-${email}`)).toHaveText(/Invited/);
    await newcomer.goto(link);
    await expect(newcomer.getByTestId('set-password-invalid')).toBeVisible();
    await anonymous.close();
});
