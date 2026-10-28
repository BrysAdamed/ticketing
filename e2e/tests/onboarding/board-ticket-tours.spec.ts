import { APIRequestContext, Locator, Page } from '@playwright/test';
import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides';
import { TourDefinition, TourStep } from '@onboarding/engine/tour.model';
import { Onboarding } from '@onboarding/onboarding.models';
import { BOARD_TOUR } from '@onboarding/tours/board.tours';
import { TICKET_TOUR } from '@onboarding/tours/ticket.tours';
import { BoardPage } from '../../pages/board.page';
import { ShellPage } from '../../pages/shell.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { markGuidesSeen } from '../../support/guides';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

interface TicketSummary {
    key: string;
}

type Role = 'Member' | 'Viewer';

/// A board linking a project the user joins with `role` (two cards) and a private project the user
/// cannot read (one card, which the user must never see or count), plus a fresh user.
async function seedBoard(api: Api, role: Role) {
    const mine = (await api.createProject()).key;
    const hidden = (await api.createProject()).key;
    const keys: string[] = [];
    for (const [project, title] of [
        [mine, 'Checkout total'],
        [mine, 'Login banner'],
        [hidden, 'Secret roadmap'],
    ])
        keys.push(
            (await api.post<TicketSummary>(`/projects/${project}/tickets`, { title, type: 'Technical' }))
                .key,
        );
    const board = await api.post<{ id: string }>('/boards', {
        name: `Tour ${mine}`,
        projectKeys: [mine, hidden],
    });
    await api.post('/tickets/move', { keys, target: board.id });
    const user = await seedUser(api, `board-tour-${role.toLowerCase()}`);
    await api.post(`/projects/${mine}/members`, { user: user.id, role });
    return { boardId: board.id, visible: keys.slice(0, 2), hidden: keys[2], user };
}

/// A ticket with a sub-ticket in a private project (delegation off) and a fresh user with `role`.
async function seedTicket(api: Api, role: Role) {
    const project = (await api.createProject()).key;
    const ticket = await api.post<TicketSummary>(`/projects/${project}/tickets`, {
        title: 'Checkout total is wrong',
        type: 'UserStory',
    });
    await api.post(`/projects/${project}/tickets`, {
        title: 'Round the VAT',
        type: 'Technical',
        parentKey: ticket.key,
    });
    const user = await seedUser(api, `ticket-tour-${role.toLowerCase()}`);
    await api.post(`/projects/${project}/members`, { user: user.id, role });
    return { key: ticket.key, user };
}

async function storedTour(request: APIRequestContext, tour: TourDefinition) {
    const response = await request.get('/api/v1/me/onboarding');
    expect(response.ok()).toBe(true);
    return ((await response.json()) as Onboarding).guides.find((g) => g.guideId === tour.id);
}

class TourCard {
    readonly root: Locator;
    readonly count: Locator;
    readonly title: Locator;

    constructor(
        private readonly page: Page,
        private readonly tour: TourDefinition,
    ) {
        this.root = page.getByTestId('tour-popover');
        this.count = this.root.getByTestId('tour-step-count');
        this.title = this.root.getByRole('heading');
    }

    async expectStep(steps: readonly TourStep[], index: number): Promise<void> {
        await expect(this.count).toHaveText(
            `${this.tour.title} tour · Step ${index + 1} of ${steps.length}`,
        );
        await expect(this.title).toHaveText(steps[index].title);
        await expect(this.page.locator(`[data-tour="${steps[index].anchor}"]`).first()).toBeVisible();
    }

    /// Walks forward with → from the first step to the last, checking each one.
    async walk(steps: readonly TourStep[]): Promise<void> {
        await this.expectStep(steps, 0);
        for (let i = 1; i < steps.length; i++) {
            await this.page.keyboard.press('ArrowRight');
            await this.expectStep(steps, i);
        }
    }

    /// Tabs to Done on the last step and presses Enter.
    async finish(): Promise<void> {
        const done = this.root.getByTestId('tour-next');
        await expect(done).toHaveText(/Done/);
        for (let i = 0; i < 5 && !(await done.evaluate((el) => el === document.activeElement)); i++)
            await this.page.keyboard.press('Tab');
        await expect(done).toBeFocused();
        await this.page.keyboard.press('Enter');
        await expect(this.root).toBeHidden();
    }
}

/// Opens the Help menu from the keyboard and starts "Tour of this page".
async function startFromHelpMenu(page: Page, shell: ShellPage): Promise<void> {
    await shell.helpTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(shell.helpItem('help-tour-page')).toBeEnabled();
    await page.keyboard.press('ArrowDown');
    await expect(shell.helpItem('help-tour-page')).toBeFocused();
    await page.keyboard.press('Enter');
}

const readable = (tour: TourDefinition) => tour.steps.filter((s) => !s.requires);

test.describe('board tour', () => {
    test('a Member walks every step with the keyboard and completion is stored', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedBoard(api, 'Member');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const board = new BoardPage(page);
        const tour = new TourCard(page, BOARD_TOUR);
        const steps = BOARD_TOUR.steps;
        await board.goto(seeded.boardId);
        await expect(board.card(seeded.visible[0])).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert: a labelled modal dialog, every step, ← goes back
        await expect(page.getByRole('dialog', { name: steps[0].title })).toHaveAttribute(
            'aria-modal',
            'true',
        );
        await tour.walk(steps);
        await page.keyboard.press('ArrowLeft');
        await tour.expectStep(steps, steps.length - 2);
        await page.keyboard.press('ArrowRight');

        // Assert: the hidden-cards step shows counts without the unreadable project's card
        await expect(page.getByTestId('board-stats')).toContainText('2 tickets');
        await expect(board.card(seeded.hidden)).toHaveCount(0);
        await expect(tour.root).not.toContainText(/\d+ hidden/);

        // Act
        await tour.finish();

        // Assert
        await expect(shell.helpTrigger).toBeFocused();
        await expect
            .poll(async () => storedTour(context.request, BOARD_TOUR))
            .toMatchObject({ state: 'Completed', version: BOARD_TOUR.version });
        await context.close();
    });

    test('a Viewer gets the tour without the placing step, and Esc dismisses it', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedBoard(api, 'Viewer');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const board = new BoardPage(page);
        const tour = new TourCard(page, BOARD_TOUR);
        const steps = readable(BOARD_TOUR);
        await board.goto(seeded.boardId);
        await expect(board.card(seeded.visible[0])).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert
        expect(steps.map((s) => s.id)).not.toContain('place');
        await expect(page.locator('[data-tour="board.add-tickets"]')).toHaveCount(0);
        await tour.walk(steps);

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(tour.root).toBeHidden();
        await expect(shell.helpTrigger).toBeFocused();
        await expect
            .poll(async () => storedTour(context.request, BOARD_TOUR))
            .toMatchObject({ state: 'Dismissed', version: BOARD_TOUR.version });
        await context.close();
    });

    test('the free-transitions hint starts the board tour', async ({ browser, api }) => {
        // Arrange: every auto-shown guide seen except this hint
        const seeded = await seedBoard(api, 'Member');
        const { context, page } = await signInAs(
            browser,
            { email: seeded.user.email, password: PASSWORD },
            { keepGuides: true },
        );
        await markGuidesSeen(
            context.request,
            AUTO_SHOWN_GUIDES.filter((g) => g.id !== 'hint.free-transitions'),
        );
        const board = new BoardPage(page);
        const tour = new TourCard(page, BOARD_TOUR);
        const hint = page.getByTestId('hint-free-transitions');
        await board.goto(seeded.boardId);
        await expect(hint).toBeVisible();

        // Act
        await hint.getByTestId('hint-learn-more').focus();
        await page.keyboard.press('Enter');

        // Assert: the tour runs, the hint gives way to it
        await tour.expectStep(BOARD_TOUR.steps, 0);
        await expect(hint).toHaveCount(0);

        // Act
        await page.keyboard.press('Escape');

        // Assert: the hint was not dismissed, so it comes back
        await expect(tour.root).toBeHidden();
        await expect(hint).toBeVisible();
        await context.close();
    });
});

test.describe('ticket tour', () => {
    test('a Member walks every step but Delegate (delegation off) and completion is stored', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedTicket(api, 'Member');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const ticket = new TicketPage(page);
        const tour = new TourCard(page, TICKET_TOUR);
        const steps = TICKET_TOUR.steps.filter((s) => s.id !== 'delegate');
        await ticket.goto(seeded.key);
        await expect(ticket.composer).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert
        await expect(page.getByRole('dialog', { name: steps[0].title })).toHaveAttribute(
            'aria-modal',
            'true',
        );
        await tour.walk(steps);
        await expect(page.locator('[data-tour="ticket.delegate"]')).toHaveCount(0);
        await page.keyboard.press('ArrowLeft');
        await tour.expectStep(steps, steps.length - 2);
        await page.keyboard.press('ArrowRight');

        // Act
        await tour.finish();

        // Assert: focus is back, `w` works again, Completed is stored
        await expect(shell.helpTrigger).toBeFocused();
        await expect
            .poll(async () => storedTour(context.request, TICKET_TOUR))
            .toMatchObject({ state: 'Completed', version: TICKET_TOUR.version });
        await page.locator('body').press('w');
        await expect(ticket.watchToggle).toHaveAttribute('aria-pressed', 'true');
        await context.close();
    });

    test('a Viewer gets the reading steps only, and Esc dismisses the tour', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedTicket(api, 'Viewer');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const ticket = new TicketPage(page);
        const tour = new TourCard(page, TICKET_TOUR);
        const steps = readable(TICKET_TOUR);
        await ticket.goto(seeded.key);
        await expect(ticket.title).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert
        expect(steps.map((s) => s.id)).not.toContain('mentions');
        await tour.walk(steps);

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(tour.root).toBeHidden();
        await expect
            .poll(async () => storedTour(context.request, TICKET_TOUR))
            .toMatchObject({ state: 'Dismissed', version: TICKET_TOUR.version });
        await context.close();
    });
});
