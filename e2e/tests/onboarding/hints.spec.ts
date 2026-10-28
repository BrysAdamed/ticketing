import { APIRequestContext, Page } from '@playwright/test';
import { Onboarding } from '@onboarding/onboarding.models';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

interface TicketSummary {
    key: string;
}

const ONBOARDING = '/api/v1/me/onboarding';

function onboardingLoaded(page: Page): Promise<unknown> {
    return page.waitForResponse((r) => new URL(r.url()).pathname === ONBOARDING && r.ok());
}

async function stored(request: APIRequestContext, guideId: string) {
    const response = await request.get(ONBOARDING);
    expect(response.ok()).toBe(true);
    return ((await response.json()) as Onboarding).guides.find((g) => g.guideId === guideId);
}

async function boardWithTicket(api: Api, visibility: 'Private' | 'Public') {
    const project = (await api.createProject({ visibility })).key;
    const ticket = await api.post<TicketSummary>(`/projects/${project}/tickets`, {
        title: 'Hinted ticket',
        type: 'UserStory',
    });
    const board = await api.post<{ id: string }>('/boards', {
        name: `Hints ${project}`,
        projectKeys: [project],
    });
    await api.post('/tickets/move', { keys: [ticket.key], target: board.id });
    return { project, ticket: ticket.key, boardId: board.id };
}

test.describe('contextual hints', () => {
    test('a hint appears once, is dismissed and stays gone after a reload', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'hint');
        const { context, page } = await signInAs(
            browser,
            { email: user.email, password: PASSWORD },
            { keepGuides: true },
        );
        const hint = page.getByTestId('hint-private-404');

        // Act
        await page.goto('/no-such-page');

        // Assert: exactly one hint on the page
        await expect(hint).toBeVisible();
        await expect(hint).toContainText("Projects you can't read look as if they don't exist");
        await expect(page.getByRole('note')).toHaveCount(1);

        // Act: dismiss
        await hint.getByRole('button', { name: 'Got it, dismiss hint' }).click();

        // Assert
        await expect(hint).toBeHidden();
        await expect
            .poll(async () => (await stored(context.request, 'hint.private-404'))?.state)
            .toBe('Dismissed');

        // Act: reload
        const loaded = onboardingLoaded(page);
        await page.reload();
        await loaded;

        // Assert
        await expect(page.getByTestId('view-app.not-found')).toBeVisible();
        await expect(hint).toHaveCount(0);
        await context.close();
    });

    test('the backlog hint gives way to the status picker, which carries its own hint', async ({
        browser,
        api,
    }) => {
        // Arrange
        const project = (await api.createProject({ visibility: 'Public' })).key;
        const ticket = await api.post<TicketSummary>(`/projects/${project}/tickets`, {
            title: 'Pick my status',
            type: 'Technical',
        });
        const user = await seedUser(api, 'hint-backlog');
        const { context, page } = await signInAs(
            browser,
            { email: user.email, password: PASSWORD },
            { keepGuides: true },
        );
        const backlogHint = page.getByTestId('hint-backlog-vs-boards');

        // Act
        await page.goto(`/projects/${project}/backlog`);

        // Assert
        await expect(backlogHint).toBeVisible();
        await expect(page.getByTestId('hint-free-transitions')).toHaveCount(0);

        // Act: open the row's status picker
        await page.getByTestId(`backlog-row-${ticket.key}`).getByTestId('row-status').click();

        // Assert: one hint at a time, the picker's
        const picker = page.getByTestId('inline-picker');
        await expect(picker.getByTestId('hint-free-transitions')).toBeVisible();
        await expect(backlogHint).toBeHidden();

        // Act: close the picker
        await page.keyboard.press('Escape');

        // Assert
        await expect(picker).toBeHidden();
        await expect(backlogHint).toBeVisible();
        await context.close();
    });

    test('a Viewer does not see a hint about a write action that a Member sees', async ({
        browser,
        api,
    }) => {
        // Arrange
        const { project, boardId, ticket } = await boardWithTicket(api, 'Private');
        const viewer = await seedUser(api, 'hint-viewer');
        const member = await seedUser(api, 'hint-member');
        await api.post(`/projects/${project}/members`, { user: viewer.email, role: 'Viewer' });
        await api.post(`/projects/${project}/members`, { user: member.email, role: 'Member' });

        // Act: the Member opens the board
        const asMember = await signInAs(
            browser,
            { email: member.email, password: PASSWORD },
            { keepGuides: true },
        );
        await asMember.page.goto(`/boards/${boardId}`);

        // Assert
        await expect(asMember.page.getByTestId(`board-card-${ticket}`)).toBeVisible();
        await expect(asMember.page.getByTestId('hint-free-transitions')).toContainText(
            'Any status can move to any other',
        );
        await asMember.context.close();

        // Act: the Viewer opens the same board
        const asViewer = await signInAs(
            browser,
            { email: viewer.email, password: PASSWORD },
            { keepGuides: true },
        );
        const loaded = onboardingLoaded(asViewer.page);
        await asViewer.page.goto(`/boards/${boardId}`);
        await loaded;

        // Assert
        await expect(asViewer.page.getByTestId(`board-card-${ticket}`)).toBeVisible();
        await expect(asViewer.page.getByTestId('hint-free-transitions')).toHaveCount(0);
        await asViewer.context.close();
    });
});
