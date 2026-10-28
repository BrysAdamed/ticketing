import { NotificationsPanel } from '../../pages/notifications.page';
import { ShellPage } from '../../pages/shell.page';
import { TicketPage } from '../../pages/ticket.page';
import { Page } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

interface TicketSummary {
    key: string;
}

interface Watchers {
    users: { id: string }[];
}

interface CommentDto {
    body: string;
    mentions: { id: string }[];
}

test.describe('@mentions', () => {
    test('picking a reader with @ in a comment shows a chip, notifies them and makes them watch', async ({
        page,
        browser,
        api,
    }) => {
        // Arrange: a public project, a ticket and a second user who can read it
        const projectKey = (await api.createProject({ visibility: 'Public' })).key;
        const { key } = await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Refund flow',
            type: 'UserStory',
        });
        const reader = await seedUser(api, 'mention');
        const ticket = new TicketPage(page);
        await ticket.goto(key);

        // Act: type @ and part of the reader's email, pick with Enter
        await ticket.composer.click();
        await ticket.composer.pressSequentially(
            `Can you check this @${reader.email.split('@')[0]}`,
        );
        const picker = page.getByTestId('mention-picker');
        const option = picker.getByTestId(`mention-option-${reader.email}`);
        await expect(option).toHaveAttribute('aria-selected', 'true');
        await ticket.composer.press('Enter');

        // Assert: the token is in the text and the picker is gone
        await expect(picker).toBeHidden();
        await expect(ticket.composer).toHaveValue(
            `Can you check this @[${reader.displayName}](user:${reader.id}) `,
        );

        // Act: submit
        await ticket.composer.press('ControlOrMeta+Enter');

        // Assert: the comment shows a chip with the reader's name
        const chip = ticket.activity.getByTestId(`mention-${reader.id}`);
        await expect(chip).toHaveText(new RegExp(`${reader.displayName}$`));
        const comments = await api.get<Page<CommentDto>>(`/tickets/${key}/comments`, { limit: 25 });
        expect(comments.items.at(-1)?.mentions.map((m) => m.id)).toEqual([reader.id]);

        // Assert: the reader watches the ticket now
        const watchers = await api.get<Watchers>(`/tickets/${key}/watchers`);
        expect(watchers.users.map((u) => u.id)).toContain(reader.id);

        // Act: the reader signs in in a browser of their own
        const { context, page: readerPage } = await signInAs(browser, {
            email: reader.email,
            password: PASSWORD,
        });
        await readerPage.goto('/my-work');
        await new ShellPage(readerPage).expectVisible();
        const bell = new NotificationsPanel(readerPage);

        // Assert: one unread "mentioned you in a comment"
        await expect(bell.badge).toHaveText('1');
        await bell.openWithShortcut();
        const row = bell.panel.locator('[data-testid^="notification-row-"]').first();
        await expect(row).toContainText('mentioned you in a comment');
        await expect(row).toContainText(key);

        // Act: open it
        await row.click();

        // Assert: the peek shows the ticket with the chip, and the badge is cleared
        const peek = new TicketPage(readerPage, 'peek');
        await expect(readerPage).toHaveURL(new RegExp(`peek=${key}`));
        await expect(peek.root).toBeVisible();
        await expect(peek.activity.getByTestId(`mention-${reader.id}`)).toBeVisible();
        await expect(bell.badge).toBeHidden();

        await context.close();
    });
});
