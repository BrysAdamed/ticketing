import { BoardPage } from '../../pages/board.page';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { markGuidesSeenAs } from '../../support/guides';
import { PASSWORD, seedUser } from './identity';

interface TicketSummary {
    key: string;
}

test.describe('@avatars', () => {
    test('a chosen animal avatar shows on a board card and a comment', async ({ page, api }) => {
        // Arrange: a user who picked the fox on teal, assigned to a board ticket they commented on
        const user = await seedUser(api, 'avatar');
        const asUser = await Api.signIn(user.email, PASSWORD);
        await asUser.patch('/me', { avatarIcon: 'fox', avatarColor: 'teal' });
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const board = await api.post<{ id: string }>('/boards', {
            name: `Avatars ${projectKey}`,
            projectKeys: [projectKey],
        });
        const { key } = await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Pick a mascot',
            type: 'UserStory',
            assignee: user.email,
        });
        await api.post('/tickets/move', { keys: [key], target: board.id });
        await asUser.post(`/tickets/${key}/comments`, { body: 'The fox it is.' });
        await asUser.dispose();

        // Act
        const boardPage = new BoardPage(page);
        await boardPage.goto(board.id);

        // Assert: the card's assignee avatar is the fox image, not initials
        const cardAvatar = boardPage.card(key).locator('tk-avatar[data-avatar-icon="fox"]');
        await expect(cardAvatar).toBeVisible();
        await expect(cardAvatar.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml,/);
        await expect(cardAvatar).toHaveAttribute('style', /--tk-palette-6\)/);

        // Act
        const ticket = new TicketPage(page);
        await ticket.goto(key);

        // Assert: the comment author shows the fox too
        const comment = ticket.activity.locator('article', { hasText: 'The fox it is.' });
        await expect(comment.locator('tk-avatar[data-avatar-icon="fox"] img')).toBeVisible();
    });

    test('picking an avatar on the profile updates the top bar at once and survives a reload', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'picker');
        await markGuidesSeenAs({ email: user.email, password: PASSWORD });
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();
        await page.goto('/login');
        await new LoginPage(page).signIn(user.email, PASSWORD);
        await new ShellPage(page).expectVisible();
        await page.goto('/profile');
        const topBarAvatar = page.getByTestId('user-menu').locator('tk-avatar');
        const owl = page.getByTestId('avatar-icon-owl');
        await expect(topBarAvatar).not.toHaveAttribute('data-avatar-icon');

        // Act: pick the owl with the keyboard and the amber colour with a click
        await page.getByTestId('avatar-icon-dog').focus();
        await page.keyboard.press('End');
        await page.keyboard.press('Home');
        for (let i = 0; i < 24; i++) await page.keyboard.press('ArrowRight');
        await expect(owl).toBeFocused();
        await page.keyboard.press('Enter');
        await page.getByTestId('avatar-color-amber').click();

        // Assert: checked, toasted, and the top bar shows it without a reload
        await expect(owl).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByTestId('avatar-color-amber')).toHaveAttribute(
            'aria-checked',
            'true',
        );
        await expect(topBarAvatar).toHaveAttribute('data-avatar-icon', 'owl');
        await expect(topBarAvatar).toHaveAttribute('style', /--tk-palette-4\)/);
        await expect(page.getByText('Avatar saved.').first()).toBeVisible();

        // Act
        await page.reload();

        // Assert: saved on the server
        await expect(topBarAvatar).toHaveAttribute('data-avatar-icon', 'owl');

        // Act: back to initials, keeping the colour
        await page.getByTestId('avatar-use-initials').click();

        // Assert
        await expect(topBarAvatar).not.toHaveAttribute('data-avatar-icon');
        await expect(topBarAvatar).toHaveText(/^\s*EP\s*$/);
        await expect(topBarAvatar).toHaveAttribute('style', /--tk-palette-4\)/);
        await context.close();
    });
});
