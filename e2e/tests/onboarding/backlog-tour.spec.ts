import { APIRequestContext, Locator, Page } from '@playwright/test';
import { BACKLOG_TOUR } from '@onboarding/tours/backlog.tours';
import { Onboarding } from '@onboarding/onboarding.models';
import { BacklogPage } from '../../pages/backlog.page';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

interface TicketSummary {
    key: string;
}

/// A private project with three backlog tickets and one on a board (so "on boards" shows), a
/// Member and a Viewer.
async function seedProject(api: Api) {
    const project = await api.createProject();
    const tickets: TicketSummary[] = [];
    for (const title of ['Checkout total', 'Login banner', 'Export CSV'])
        tickets.push(
            await api.post<TicketSummary>(`/projects/${project.key}/tickets`, {
                title,
                type: 'UserStory',
            }),
        );
    const board = await api.post<{ id: string }>('/boards', {
        name: `Tour ${project.key}`,
        projectKeys: [project.key],
    });
    await api.post('/tickets/move', { keys: [tickets[2].key], target: board.id });
    const member = await seedUser(api, 'tour-member');
    const viewer = await seedUser(api, 'tour-viewer');
    await api.post(`/projects/${project.key}/members`, { user: member.id, role: 'Member' });
    await api.post(`/projects/${project.key}/members`, { user: viewer.id, role: 'Viewer' });
    return { key: project.key, member, viewer };
}

async function onboarding(request: APIRequestContext): Promise<Onboarding> {
    const response = await request.get('/api/v1/me/onboarding');
    expect(response.ok()).toBe(true);
    return (await response.json()) as Onboarding;
}

function tourGuide(onboarding: Onboarding) {
    return onboarding.guides.find((g) => g.guideId === BACKLOG_TOUR.id);
}

class TourCard {
    readonly root: Locator;
    readonly count: Locator;
    readonly title: Locator;

    constructor(page: Page) {
        this.root = page.getByTestId('tour-popover');
        this.count = this.root.getByTestId('tour-step-count');
        this.title = this.root.getByRole('heading');
    }

    async expectStep(index: number, total: number, title: string): Promise<void> {
        await expect(this.count).toHaveText(`Backlog tour · Step ${index + 1} of ${total}`);
        await expect(this.title).toHaveText(title);
    }
}

test.describe('backlog tour', () => {
    test('a Member runs every step with the keyboard, shortcuts stay quiet, focus returns and completion is stored', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedProject(api);
        const { context, page } = await signInAs(browser, {
            email: seeded.member.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const backlog = new BacklogPage(page);
        const tour = new TourCard(page);
        const steps = BACKLOG_TOUR.steps;
        await backlog.goto(seeded.key);
        await expect(backlog.row(seeded.key + '-1')).toBeVisible();

        // Act: open the Help menu from the keyboard and start "Tour of this page"
        await shell.helpTrigger.focus();
        await page.keyboard.press('Enter');
        await expect(shell.helpItem('help-tour-page')).toBeEnabled();
        await page.keyboard.press('ArrowDown');
        await expect(shell.helpItem('help-tour-page')).toBeFocused();
        await page.keyboard.press('Enter');

        // Assert: a labelled modal dialog on the first step
        await expect(tour.root).toBeVisible();
        await expect(page.getByRole('dialog', { name: steps[0].title })).toHaveAttribute(
            'aria-modal',
            'true',
        );
        await tour.expectStep(0, steps.length, steps[0].title);
        await expect(page.locator(`[data-tour="${steps[0].anchor}"]`)).toBeVisible();

        // Act / Assert: global shortcuts are paused while a step is open
        await page.keyboard.press('c');
        await page.keyboard.press('g');
        await page.keyboard.press('m');
        await expect(backlog.quickCreateInput).toHaveCount(0);
        await expect(page).toHaveURL(new RegExp(`/projects/${seeded.key}/backlog`));
        await tour.expectStep(0, steps.length, steps[0].title);

        // Act / Assert: → through every step, ← goes back
        for (let i = 1; i < steps.length; i++) {
            await page.keyboard.press('ArrowRight');
            await tour.expectStep(i, steps.length, steps[i].title);
        }
        await page.keyboard.press('ArrowLeft');
        await tour.expectStep(steps.length - 2, steps.length, steps[steps.length - 2].title);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await tour.expectStep(steps.length - 1, steps.length, steps[steps.length - 1].title);

        // Act: finish with Done, reached by Tab
        const done = tour.root.getByTestId('tour-next');
        await expect(done).toHaveText(/Done/);
        for (let i = 0; i < 5 && !(await done.evaluate((el) => el === document.activeElement)); i++)
            await page.keyboard.press('Tab');
        await expect(done).toBeFocused();
        await page.keyboard.press('Enter');

        // Assert: closed, focus back on the Help trigger, shortcuts live again, Completed stored
        await expect(tour.root).toBeHidden();
        await expect(shell.helpTrigger).toBeFocused();
        await expect
            .poll(async () => tourGuide(await onboarding(context.request)))
            .toMatchObject({ state: 'Completed', version: BACKLOG_TOUR.version });
        await page.locator('body').press('c');
        await expect(backlog.quickCreateInput).toBeFocused();
        await context.close();
    });

    test('the palette starts the tour and Esc ends it as Dismissed', async ({ browser, api }) => {
        // Arrange
        const seeded = await seedProject(api);
        const { context, page } = await signInAs(browser, {
            email: seeded.member.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const tour = new TourCard(page);
        await page.goto(`/projects/${seeded.key}/dashboard`);
        await shell.expectVisible();

        // Act: the per-tour command opens the backlog of the project in context, then the tour
        await shell.paletteTrigger.click();
        await page.getByTestId('command-palette-input').fill('backlog tour');
        await shell.palette.getByTestId('palette-item-command:help.tour.backlog.list').click();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/projects/${seeded.key}/backlog`));
        await tour.expectStep(0, BACKLOG_TOUR.steps.length, BACKLOG_TOUR.steps[0].title);

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(tour.root).toBeHidden();
        await expect
            .poll(async () => tourGuide(await onboarding(context.request)))
            .toMatchObject({ state: 'Dismissed', version: BACKLOG_TOUR.version });
        await context.close();
    });

    test('a Viewer gets the tour without its write steps, with reduced motion', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedProject(api);
        const { context, page } = await signInAs(
            browser,
            { email: seeded.viewer.email, password: PASSWORD },
            { contextOptions: { reducedMotion: 'reduce' } },
        );
        const shell = new ShellPage(page);
        const backlog = new BacklogPage(page);
        const tour = new TourCard(page);
        const steps = BACKLOG_TOUR.steps.filter((s) => !s.requires);
        await backlog.goto(seeded.key);
        await expect(backlog.row(seeded.key + '-1')).toBeVisible();

        // Act
        await shell.openHelp();
        await shell.helpItem('help-tour-page').click();

        // Assert: read-only steps only, no animation
        await tour.expectStep(0, steps.length, steps[0].title);
        expect(steps.length).toBeLessThan(BACKLOG_TOUR.steps.length);
        await expect(page.locator('[data-tour="backlog.quick-create"]')).toHaveCount(0);
        expect(await tour.root.evaluate((el) => getComputedStyle(el).animationDuration)).toBe('0s');
        for (let i = 1; i < steps.length; i++) {
            await page.keyboard.press('ArrowRight');
            await tour.expectStep(i, steps.length, steps[i].title);
        }

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(tour.root).toBeHidden();
        await expect(shell.helpTrigger).toBeFocused();
        await context.close();
    });

    test('Tour of this page is disabled on a view without a tour', async ({ page, shell }) => {
        // Arrange
        await page.goto('/my-work');
        await shell.expectVisible();

        // Act
        await shell.openHelp();

        // Assert
        await expect(shell.helpItem('help-tour-page')).toBeDisabled();
        await expect(shell.helpItem('help-tour-page')).toContainText('No tour here');
    });
});
