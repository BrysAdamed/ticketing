import { AchievementsPage, UserCard } from '../../pages/achievements.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';
import { enableAchievementsFor, myAchievement, PROJECTOR_TIMEOUT_MS } from './achievements';

interface TicketSummary {
    key: string;
}

test.describe('@achievements sharing', () => {
    test('a teammate sees a shared medal on the user card until it is unshared', async ({
        browser,
        api,
    }) => {
        test.setTimeout(PROJECTOR_TIMEOUT_MS + 90_000);

        // Arrange: A earns Reporter with a ticket created after the flag turned on, and comments
        // on it in a public project B can read
        const owner = await seedUser(api, 'sharer');
        const viewer = await seedUser(api, 'viewer');
        await enableAchievementsFor(api, [owner.id, viewer.id]);
        const asOwner = await Api.signIn(owner.email, PASSWORD);
        await expect.poll(async () => (await myAchievement(asOwner, 'reporter'))?.tier).toBe(0);
        const projectKey = (await asOwner.createProject({ visibility: 'Public' })).key;
        const { key } = await asOwner.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Share the good news',
            type: 'Technical',
        });
        await asOwner.post(`/tickets/${key}/comments`, { body: 'First ticket here.' });
        await expect
            .poll(async () => (await myAchievement(asOwner, 'reporter'))?.tier ?? 0, {
                timeout: PROJECTOR_TIMEOUT_MS,
                intervals: [2_000],
            })
            .toBeGreaterThanOrEqual(1);

        // Act: A shares Reporter from the tab
        const ownerSession = await signInAs(browser, { email: owner.email, password: PASSWORD });
        const tab = new AchievementsPage(ownerSession.page);
        await tab.goto();
        await tab.shareButton('reporter').click();

        // Assert: shared at once, toasted with Undo, and stored
        await expect(tab.shareButton('reporter')).toHaveAttribute('aria-pressed', 'true');
        await expect(tab.sharedMarker('reporter')).toBeVisible();
        await expect(tab.openButton('reporter')).toHaveAccessibleName('Reporter, Bronze, shared');
        await expect(ownerSession.page.getByText('Reporter is shared')).toBeVisible();
        await expect
            .poll(async () => (await myAchievement(asOwner, 'reporter'))?.shared)
            .toBe(true);

        // Act: B opens A's user card from the comment author with the keyboard
        const viewerSession = await signInAs(browser, { email: viewer.email, password: PASSWORD });
        const ticket = new TicketPage(viewerSession.page);
        const card = new UserCard(viewerSession.page);
        await ticket.goto(key);
        const author = ticket.activity.getByTestId('comment-author').first();
        await author.focus();
        await viewerSession.page.keyboard.press('Enter');

        // Assert: name only, and the shared medal with its name and tier
        await expect(card.root).toBeVisible();
        await expect(card.root).toContainText(owner.displayName);
        await expect(card.root).not.toContainText(owner.email);
        await expect(card.achievements).toContainText('Shared achievements');
        await expect(card.achievement('reporter')).toHaveAccessibleName('Reporter, Bronze');
        await expect(card.achievement('closer')).toHaveCount(0);

        // Act: Esc closes the card and returns focus
        await viewerSession.page.keyboard.press('Escape');

        // Assert
        await expect(card.root).toBeHidden();
        await expect(author).toBeFocused();

        // Act: A unshares with S on the focused medal
        await tab.openButton('reporter').focus();
        await ownerSession.page.keyboard.press('s');

        // Assert
        await expect(tab.shareButton('reporter')).toHaveAttribute('aria-pressed', 'false');
        await expect(tab.sharedMarker('reporter')).toHaveCount(0);
        await expect
            .poll(async () => (await myAchievement(asOwner, 'reporter'))?.shared)
            .toBe(false);

        // Act: B opens the card again
        await author.click();

        // Assert: the person is there, the achievements section is not
        await expect(card.root).toContainText(owner.displayName);
        await expect(card.root).toHaveAttribute('data-achievements', 'loaded');
        await expect(card.achievements).toHaveCount(0);

        await asOwner.dispose();
        await ownerSession.context.close();
        await viewerSession.context.close();
    });
});
