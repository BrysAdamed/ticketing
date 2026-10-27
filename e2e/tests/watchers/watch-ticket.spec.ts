import { SearchPage } from '../../pages/search.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
    id: string;
    key: string;
    title: string;
}

interface CurrentUser {
    id: string;
    email: string;
}

interface Watchers {
    count: number;
    watching: boolean;
    users: { email: string }[];
}

async function seed(api: Api, titles: string[]): Promise<{ projectKey: string; keys: string[] }> {
    const projectKey = (await api.createProject()).key;
    const keys: string[] = [];
    for (const title of titles)
        keys.push(
            (
                await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
                    title,
                    type: 'UserStory',
                })
            ).key,
        );
    return { projectKey, keys };
}

const watching = async (api: Api, key: string) =>
    (await api.get<Watchers>(`/tickets/${key}/watchers`)).watching;

test.describe('watch tickets', () => {
    test('the reporter watches a new ticket and can unwatch and watch again with the button and W', async ({
        page,
        api,
    }) => {
        // Arrange
        const me = await api.get<CurrentUser>('/me');
        const { keys } = await seed(api, ['Watch me']);
        const ticket = new TicketPage(page);
        await ticket.goto(keys[0]);

        // Assert: reporters watch the tickets they create
        await expect(ticket.watchToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(ticket.watchToggle).toHaveText('Watching');
        await expect(ticket.watchersCount).toHaveAttribute('aria-label', '1 watcher');

        // Act: the watcher list
        await ticket.watchersCount.click();

        // Assert
        const list = page.getByTestId('ticket-watchers');
        await expect(list.getByTestId(`ticket-watcher-row-${me.email}`)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(list).toBeHidden();

        // Act: unwatch with the button
        await ticket.watchToggle.click();

        // Assert
        await expect(ticket.watchToggle).toHaveAttribute('aria-pressed', 'false');
        await expect(ticket.watchToggle).toHaveText('Watch');
        await expect(ticket.watchersCount).toHaveAttribute('aria-label', '0 watchers');
        await expect.poll(() => watching(api, keys[0])).toBe(false);

        // Act: watch again with the shortcut
        await page.keyboard.press('w');

        // Assert
        await expect(ticket.watchToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(ticket.watchersCount).toHaveAttribute('aria-label', '1 watcher');
        await expect.poll(() => watching(api, keys[0])).toBe(true);
    });

    test('W toggles only the peeked ticket while a ticket page is open behind it', async ({
        page,
        api,
    }) => {
        // Arrange
        const { keys } = await seed(api, ['Behind', 'In the peek']);
        await page.goto(`/tickets/${keys[0]}?peek=${keys[1]}`);
        const peek = new TicketPage(page, 'peek');
        await expect(peek.watchToggle).toHaveAttribute('aria-pressed', 'true');

        // Act
        await page.keyboard.press('w');

        // Assert
        await expect(peek.watchToggle).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => watching(api, keys[1])).toBe(false);
        expect(await watching(api, keys[0])).toBe(true);
        await expect(new TicketPage(page).watchToggle).toHaveAttribute('aria-pressed', 'true');
    });

    test('the Watching filter in search and the Watching section in My work list watched tickets only', async ({
        page,
        api,
    }) => {
        // Arrange
        const { projectKey, keys } = await seed(api, ['Watched one', 'Not watched']);
        const [watched, ignored] = keys;
        await api.delete(`/tickets/${ignored}/watchers/me`);
        const search = new SearchPage(page);
        await search.goto(`project=${projectKey}`);
        await expect(search.row(ignored)).toBeVisible();

        // Act
        await search.watchingFilter.click();

        // Assert: filtered, in the URL, and still on after reloading that URL
        await expect(search.row(ignored)).toBeHidden();
        await expect(search.row(watched)).toBeVisible();
        await expect(search.rows()).toHaveCount(1);
        expect(new URL(page.url()).searchParams.get('watching')).toBe('true');
        await page.reload();
        await expect(search.watchingFilter).toHaveAttribute('aria-pressed', 'true');
        await expect(search.row(watched)).toBeVisible();
        await expect(search.rows()).toHaveCount(1);

        // Act
        await page.goto('/my-work');

        // Assert
        await expect(page.getByTestId('my-work-watching')).toBeVisible();
        await expect(page.getByTestId(`my-work-watching-row-${watched}`)).toBeVisible();
        await expect(page.getByTestId(`my-work-watching-row-${ignored}`)).toHaveCount(0);
        await page.getByTestId(`my-work-watching-row-${watched}`).click();
        await expect(page).toHaveURL(new RegExp(`peek=${watched}`));
        await expect(new TicketPage(page, 'peek').watchToggle).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });
});
