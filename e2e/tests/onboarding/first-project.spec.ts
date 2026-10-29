import { APIRequestContext, Locator, Page } from '@playwright/test';
import { WELCOME_GUIDE } from '@onboarding/guides/welcome';
import { Onboarding } from '@onboarding/onboarding.models';
import { FIRST_PROJECT_TOUR } from '@onboarding/walkthrough/first-project.tour';
import { expect, test } from '../../support/fixtures';
import { uniqueProjectKey } from '../../support/api';
import { xsrfToken } from '../../support/guides';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

const STEPS = FIRST_PROJECT_TOUR.steps;
const SHOTS = process.env.E2E_SCREENSHOTS === '1';

interface Ticket {
    key: string;
    status: string;
    location: { kind: string; boardId: string | null };
}

async function json<T>(request: APIRequestContext, path: string): Promise<T> {
    const response = await request.get(`/api/v1${path}`);
    expect(response.ok(), `GET ${path} → ${response.status()}`).toBe(true);
    return (await response.json()) as T;
}

/// A POST as the signed-in user of `request` (cookie session, XSRF header).
async function postAs<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
    const response = await request.post(`/api/v1${path}`, {
        data,
        headers: { 'X-XSRF-TOKEN': await xsrfToken(request) },
    });
    expect(response.ok(), `POST ${path} → ${response.status()}`).toBe(true);
    return (await response.json()) as T;
}

async function ownedKeys(request: APIRequestContext): Promise<string[]> {
    const page = await json<{ items: { key: string; myRole: string }[] }>(
        request,
        '/projects?mine=true&limit=100',
    );
    return page.items.filter((p) => p.myRole === 'Owner').map((p) => p.key);
}

class Walkthrough {
    readonly card: Locator;
    readonly count: Locator;
    readonly title: Locator;
    readonly pill: Locator;

    constructor(private readonly page: Page) {
        this.card = page.getByTestId('tour-popover');
        this.count = this.card.getByTestId('tour-step-count');
        this.title = this.card.getByRole('heading');
        this.pill = page.getByTestId('tour-pill');
    }

    /// Starts it from the palette (`help.tour.first-project`) with the keyboard.
    async startFromPalette(): Promise<void> {
        await this.page.keyboard.press('Control+k');
        await this.page.getByTestId('command-palette-input').fill('Your first project');
        const item = this.page.getByTestId('palette-item-command:help.tour.first-project');
        await expect(item).toBeVisible();
        for (let i = 0; i < 10 && (await item.getAttribute('aria-selected')) !== 'true'; i++)
            await this.page.keyboard.press('ArrowDown');
        await expect(item).toHaveAttribute('aria-selected', 'true');
        await this.page.keyboard.press('Enter');
    }

    async expectStep(stepId: string, stage: number): Promise<void> {
        const step = STEPS.find((s) => s.id === stepId)!;
        await expect(this.card).toHaveAttribute('data-step', stepId);
        await expect(this.card).not.toHaveClass(/pending/);
        await expect(this.count).toHaveText(`Your first project · Step ${stage} of 7`);
        if (!step.title.includes('{')) await expect(this.title).toHaveText(step.title);
    }

    /// The anchor of the current step is visible and lit by the spotlight.
    async expectAnchor(stepId: string): Promise<void> {
        const step = STEPS.find((s) => s.id === stepId)!;
        await expect(this.page.locator(`[data-tour="${step.anchor}"]`).first()).toBeVisible();
        await expect(this.page.getByTestId('tour-spotlight-hole')).toBeVisible();
    }

    /// Enter on the step's action button, which an action-driven step focuses.
    async pressAction(): Promise<void> {
        await expect(this.card.getByTestId('tour-action')).toBeFocused();
        await this.page.keyboard.press('Enter');
    }

    async shot(name: string): Promise<void> {
        if (!SHOTS) return;
        await this.page.waitForTimeout(300);
        for (const scheme of ['light', 'dark'] as const) {
            await this.page.emulateMedia({ colorScheme: scheme });
            await this.page.waitForTimeout(150);
            await this.page.screenshot({
                path: `../docs/screenshots/tkt-80-${name}-${scheme}.png`,
            });
        }
        await this.page.emulateMedia({ colorScheme: 'light' });
    }
}

test.describe('"Your first project" walkthrough', () => {
    test('a fresh user runs every step with the keyboard, restarts once without a second project, and completes it', async ({
        browser,
        api,
    }) => {
        test.setTimeout(180_000);
        // Arrange
        const user = await seedUser(api, 'first-project');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const walkthrough = new Walkthrough(page);
        await page.goto('/my-work');
        await expect(page.getByTestId('view-my-work.list')).toBeVisible();

        // Act + Assert: step 1, the create-project dialog with suggestions
        await walkthrough.startFromPalette();
        await expect(page).toHaveURL(/\/projects$/);
        await walkthrough.expectStep('create-project', 1);
        await walkthrough.expectAnchor('create-project');
        await expect(walkthrough.card).toContainText(`${user.displayName}'s sandbox`);
        await expect(walkthrough.card.getByTestId('tour-waiting')).toHaveText(
            'Waiting for you to create the project',
        );
        await expect(walkthrough.card).not.toHaveAttribute('aria-modal', 'true');
        await walkthrough.shot('step-1');
        await walkthrough.pressAction();
        await expect(page.getByTestId('new-project-name')).toHaveValue(
            new RegExp(`^${user.displayName}'s sandbox( \\d+)?$`),
        );
        const key = await page.getByTestId('new-project-key').inputValue();
        expect(key).toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
        await expect(walkthrough.card).toHaveClass(/pending/);
        await walkthrough.shot('step-1-dialog');
        await page.keyboard.press('Control+Enter');

        // Step 2: a ticket through quick-create
        await expect(page).toHaveURL(new RegExp(`/projects/${key}/backlog`));
        await walkthrough.expectStep('create-ticket', 2);
        await walkthrough.expectAnchor('create-ticket');
        await walkthrough.shot('step-2');
        await walkthrough.pressAction();
        await expect(page.getByPlaceholder('Ticket title')).toBeFocused();
        await page.keyboard.type('My first ticket');
        await page.keyboard.press('Enter');
        await walkthrough.expectStep('change-status', 3);
        await walkthrough.expectAnchor('change-status');
        await expect(walkthrough.card).toContainText(`${key}-1`);
        await walkthrough.shot('step-3');

        // Restart after step 2: Esc ends it, the palette resumes at step 3 on the same project
        await page.keyboard.press('Escape');
        await expect(walkthrough.card).toBeHidden();
        await expect
            .poll(async () => {
                const state = await json<Onboarding>(context.request, '/me/onboarding');
                return state.guides.find((g) => g.guideId === FIRST_PROJECT_TOUR.id)?.state;
            })
            .toBe('Dismissed');
        await walkthrough.startFromPalette();
        const choice = page.getByTestId('first-project-choice');
        await expect(choice).toBeVisible();
        await expect(choice.getByTestId('first-project-use')).toBeFocused();
        await walkthrough.shot('step-0');
        await page.keyboard.press('Enter');
        await walkthrough.expectStep('change-status', 3);
        expect(await ownedKeys(context.request)).toEqual([key]);

        // Step 3: change the status (optional)
        await walkthrough.pressAction();
        await expect(page.getByPlaceholder('Change status…')).toBeFocused();
        await page.keyboard.type('In Progress');
        await page.keyboard.press('Enter');

        // Step 4: a board that links the project, with suggestions
        await expect(page).toHaveURL(/\/boards$/);
        await walkthrough.expectStep('create-board', 4);
        await walkthrough.expectAnchor('create-board');
        await walkthrough.shot('step-4');
        await walkthrough.pressAction();
        await expect(page.getByTestId('create-board-name')).toHaveValue('My first board');
        await expect(page.getByTestId(`create-board-project-${key}`)).toHaveAttribute(
            'aria-pressed',
            'true',
        );
        await page.keyboard.press('Control+Enter');

        // Step 5: place the ticket on the board
        await expect(page).toHaveURL(/\/boards\/[0-9a-f-]+$/);
        await walkthrough.expectStep('place-ticket', 5);
        await walkthrough.expectAnchor('place-ticket');
        await walkthrough.shot('step-5');
        await walkthrough.pressAction();
        const row = page.getByTestId(`add-tickets-row-${key}-1`);
        await expect(async () => {
            await row.focus();
            await page.keyboard.press('Space');
            await expect(row).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
        }).toPass();
        await page.getByTestId('add-tickets-submit').focus();
        await page.keyboard.press('Enter');

        // Step 6: the dashboard tour steps, Next-driven and modal again
        await expect(page).toHaveURL(new RegExp(`/projects/${key}/dashboard`));
        const dashboard = STEPS.filter((s) => s.stage === 'dashboard');
        for (const [i, step] of dashboard.entries()) {
            await walkthrough.expectStep(step.id, 6);
            await walkthrough.expectAnchor(step.id);
            if (i === 0) {
                await expect(walkthrough.card).toHaveAttribute('aria-modal', 'true');
                await walkthrough.shot('step-6');
            }
            await page.keyboard.press('ArrowRight');
        }

        // Step 7: finish
        await walkthrough.expectStep('finish', 7);
        await walkthrough.expectAnchor('finish');
        await expect(walkthrough.card).toContainText(`its key ${key} stays reserved`);
        await walkthrough.shot('step-7');
        await page.getByTestId('tour-next').focus();
        await page.keyboard.press('Enter');
        await expect(walkthrough.card).toBeHidden();

        // Assert: real data and the stored guide
        const project = await json<{ visibility: string }>(context.request, `/projects/${key}`);
        expect(project.visibility).toBe('Private');
        const ticket = await json<Ticket>(context.request, `/tickets/${key}-1`);
        expect(ticket.status).toBe('InProgress');
        expect(ticket.location.kind).toBe('Board');
        expect(ticket.location.boardId).toBeTruthy();
        await expect
            .poll(async () => {
                const state = await json<Onboarding>(context.request, '/me/onboarding');
                return state.guides.find((g) => g.guideId === FIRST_PROJECT_TOUR.id);
            })
            .toMatchObject({ state: 'Completed', version: FIRST_PROJECT_TOUR.version });
        expect(await ownedKeys(context.request)).toEqual([key]);
        await context.close();
    });

    test('wandering off pauses it behind the pill; Continue resumes and Esc in the pill ends it', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'first-project-pause');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const walkthrough = new Walkthrough(page);
        await page.goto('/my-work');
        await expect(page.getByTestId('view-my-work.list')).toBeVisible();
        await walkthrough.startFromPalette();
        await walkthrough.expectStep('create-project', 1);

        // Act: shortcuts stay live during an action step, so g m leaves the page
        await page.keyboard.press('g');
        await page.keyboard.press('m');

        // Assert
        await expect(page).toHaveURL(/\/my-work$/);
        await expect(walkthrough.pill).toBeVisible();
        await expect(walkthrough.card).toBeHidden();
        await expect(walkthrough.pill.getByTestId('tour-pill-step')).toHaveText(
            'Paused at step 1 of 7 · Create a private project',
        );
        await walkthrough.shot('paused');
        await walkthrough.pill.getByTestId('tour-pill-continue').focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/projects$/);
        await walkthrough.expectStep('create-project', 1);

        await page.keyboard.press('g');
        await page.keyboard.press('m');
        await expect(walkthrough.pill).toBeVisible();
        await walkthrough.pill.getByTestId('tour-pill-continue').focus();
        await page.keyboard.press('Escape');
        await expect(walkthrough.pill).toBeHidden();
        await expect
            .poll(async () => {
                const state = await json<Onboarding>(context.request, '/me/onboarding');
                return state.guides.find((g) => g.guideId === FIRST_PROJECT_TOUR.id)?.state;
            })
            .toBe('Dismissed');
        expect(await ownedKeys(context.request)).toEqual([]);
        await context.close();
    });

    test('the projects list empty state starts it at step 1', async ({ browser, api }) => {
        // Arrange
        const user = await seedUser(api, 'first-project-projects');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const walkthrough = new Walkthrough(page);
        await page.goto('/projects');
        await expect(page.getByTestId('view-projects.list')).toBeVisible();
        const projects = await json<{ items: unknown[] }>(context.request, '/projects');
        test.skip(projects.items.length > 0, 'public projects of other specs fill the list');
        const state = page.locator('tk-empty-state');

        // Act
        await state.getByTestId('empty-state-learn').click();

        // Assert
        await walkthrough.expectStep('create-project', 1);
        await page.keyboard.press('Escape');
        await expect(walkthrough.card).toBeHidden();
        await context.close();
    });

    test('the boards list empty state resumes at Create a board for a user with a project and a ticket', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'first-project-boards');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const key = uniqueProjectKey('FP');
        await postAs(context.request, '/projects', { key, name: `E2E ${key}` });
        await postAs(context.request, `/projects/${key}/tickets`, {
            title: 'My first ticket',
            type: 'Technical',
        });
        const walkthrough = new Walkthrough(page);
        await page.goto('/boards');
        await expect(page.getByTestId('view-boards.list')).toBeVisible();
        const boards = await json<{ items: unknown[] }>(context.request, '/boards');
        test.skip(boards.items.length > 0, 'boards of other specs fill the list');
        const learn = page.locator('tk-empty-state').getByTestId('empty-state-learn');
        await expect(learn).toHaveText(/How boards work/);

        // Act
        await learn.click();
        await expect(page.getByTestId('first-project-use')).toBeFocused();
        await page.keyboard.press('Enter');

        // Assert
        await walkthrough.expectStep('create-board', 4);
        await expect(walkthrough.card).toContainText(key);
        await page.keyboard.press('Escape');
        await expect(walkthrough.card).toBeHidden();
        await context.close();
    });

    test('the welcome dialog’s Take the tour starts it for a user who cannot write anywhere', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'first-project-welcome');
        const { context, page } = await signInAs(
            browser,
            { email: user.email, password: PASSWORD },
            { keepGuides: (g) => g.id === WELCOME_GUIDE.id },
        );
        const projects = await json<{ items: unknown[] }>(context.request, '/projects');
        test.skip(projects.items.length > 0, 'public projects of other specs are writable');
        const walkthrough = new Walkthrough(page);
        await page.goto('/my-work');
        await expect(page.getByTestId('welcome-dialog')).toBeVisible();

        // Act
        await page.keyboard.press('Enter');

        // Assert
        await expect(page.getByTestId('welcome-dialog')).toBeHidden();
        await walkthrough.expectStep('create-project', 1);
        await page.keyboard.press('Escape');
        await expect(walkthrough.card).toBeHidden();
        await context.close();
    });
});
