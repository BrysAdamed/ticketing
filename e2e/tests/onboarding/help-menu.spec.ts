import { Page as BrowserPage } from '@playwright/test';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { expect, test } from '../../support/fixtures';
import { PASSWORD, seedUser } from '../identity/identity';

interface Onboarding {
    guides: { guideId: string; version: number; state: string }[];
}

const ONBOARDING = '/api/v1/me/onboarding';

/// Onboarding writes accept the cookie session only, so they go through the page's own request
/// context with the XSRF token echoed from its cookie.
async function setGuide(page: BrowserPage, guideId: string): Promise<void> {
    const cookies = await page.context().cookies();
    const xsrf = cookies.find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
    const response = await page.request.put(`${ONBOARDING}/guides/${guideId}`, {
        data: { version: 1, state: 'Dismissed' },
        headers: { 'X-XSRF-TOKEN': xsrf },
    });
    expect(response.ok(), await response.text()).toBe(true);
}

async function guideIds(page: BrowserPage): Promise<string[]> {
    const response = await page.request.get(ONBOARDING);
    expect(response.ok()).toBe(true);
    return ((await response.json()) as Onboarding).guides.map((g) => g.guideId);
}

test.describe('Help menu', () => {
    test('opens from the keyboard, moves with arrows, returns focus on Esc and opens the shortcut sheet', async ({
        page,
        shell,
    }) => {
        // Arrange
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act: open from the keyboard
        await shell.helpTrigger.focus();
        await page.keyboard.press('Enter');

        // Assert: Keyboard shortcuts first, Restart all guides last
        await expect(shell.helpMenu).toBeVisible();
        const items = shell.helpMenu.getByRole('menuitem');
        await expect(items.first()).toHaveAttribute('data-testid', 'help-shortcuts');
        await expect(items.last()).toHaveAttribute('data-testid', 'help-restart-guides');
        await expect(shell.helpItem('help-shortcuts')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(items.nth(1)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(shell.helpMenu).toBeHidden();
        await expect(shell.helpTrigger).toBeFocused();

        // Act: Keyboard shortcuts from the menu
        await shell.openHelp();
        await shell.helpItem('help-shortcuts').click();

        // Assert
        await expect(page.getByTestId('shortcut-help-search')).toBeVisible();
    });

    test('the palette has a Help group with Keyboard shortcuts and Restart all guides', async ({
        page,
        shell,
    }) => {
        // Arrange
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act
        await shell.paletteTrigger.click();
        await page.getByTestId('command-palette-input').fill('guides');

        // Assert
        await expect(shell.palette.getByRole('group', { name: 'Help' })).toBeVisible();
        await expect(
            shell.palette.getByTestId('palette-item-command:help.restart-guides'),
        ).toBeVisible();
        await page.getByTestId('command-palette-input').fill('keyboard shortcuts');
        await expect(shell.palette.getByTestId('palette-item-command:help.shortcuts')).toBeVisible();
    });

    test('Restart all guides confirms, forgets every guide and shows a toast', async ({
        browser,
        api,
    }) => {
        // Arrange: a fresh user who dismissed a guide, so the shared admin's state is untouched
        const user = await seedUser(api, 'help');
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();
        const shell = new ShellPage(page);
        await page.goto('/login');
        await new LoginPage(page).signIn(user.email, PASSWORD);
        await shell.expectVisible();
        await setGuide(page, 'hint.free-transitions');
        expect(await guideIds(page)).toEqual(['hint.free-transitions']);

        // Act
        await shell.openHelp();
        await shell.helpItem('help-restart-guides').click();
        await expect(page.getByRole('heading', { name: 'Restart all guides?' })).toBeVisible();
        await page.getByTestId('confirm-ok').click();

        // Assert
        await expect(page.getByTestId('toast')).toContainText('All guides restarted');
        await expect.poll(() => guideIds(page)).toEqual([]);
        await context.close();
    });
});
