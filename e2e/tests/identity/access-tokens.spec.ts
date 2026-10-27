import { request } from '@playwright/test';
import { AccessTokensPage } from '../../pages/identity.page';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { expect, test } from '../../support/fixtures';
import { BASE_URL } from '../../support/env';
import { PASSWORD, seedUser } from './identity';

test('a user creates a token, calls the API with it and revokes it', async ({ browser, api }) => {
    // Arrange
    const user = await seedUser(api, 'pat');
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/login');
    await new LoginPage(page).signIn(user.email, PASSWORD);
    await new ShellPage(page).expectVisible();
    const tokens = new AccessTokensPage(page);
    await tokens.goto();

    // Act
    const secret = await tokens.createToken('E2E script', 'ReadOnly');
    const client = await request.newContext({
        baseURL: BASE_URL,
        extraHTTPHeaders: { Authorization: `Bearer ${secret}` },
    });
    const me = await client.get('/api/v1/me');
    const write = await client.post('/api/v1/projects', { data: { key: 'NOPE', name: 'Nope' } });
    await page.getByTestId('token-revoke-E2E script').click();
    await page.getByTestId('confirm-ok').click();
    await expect(page.getByTestId('toast')).toContainText('revoked');

    // Assert
    expect(secret).toMatch(/^tkt_[0-9A-Za-z]{40}$/);
    expect(me.status()).toBe(200);
    expect((await me.json()).email).toBe(user.email);
    expect(write.status()).toBe(403);
    await expect(tokens.row('E2E script')).toContainText('Revoked');
    expect((await client.get('/api/v1/me')).status()).toBe(401);
    await client.dispose();
    await context.close();
});

test('the show-once dialog offers a Claude Code command for this server', async ({ page }) => {
    // Arrange
    const tokens = new AccessTokensPage(page);
    await tokens.goto();
    await page.getByTestId('tokens-new').click();
    await page.getByTestId('token-name').fill(`snippet-${Date.now()}`);

    // Act
    await page.getByTestId('token-create').click();

    // Assert
    const secret = await page.getByTestId('token-secret').inputValue();
    await expect(page.getByTestId('token-snippet-text')).toHaveText(
        `claude mcp add --transport http ticketing ${new URL(page.url()).origin}/mcp --header "Authorization: Bearer ${secret}"`,
    );
    await page.getByTestId('token-done').click();
    await expect(page.getByTestId('token-close-anyway')).toBeVisible();
    await page.getByTestId('token-close-anyway').click();
    await expect(page.getByTestId('token-secret')).toBeHidden();
});
