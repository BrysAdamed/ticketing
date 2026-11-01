import { APIRequestContext, Locator, Page } from '@playwright/test';
import { TourDefinition, TourStep } from '@onboarding/engine/tour.model';
import { Onboarding } from '@onboarding/onboarding.models';
import { DOCS_DOC_TOUR, DOCS_HOME_TOUR } from '@onboarding/tours/docs.tours';
import { SEARCH_TOUR } from '@onboarding/tours/search.tours';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

const SHOTS = process.env.E2E_SCREENSHOTS === '1';

interface Keyed {
    key: string;
}

type Role = 'Member' | 'Viewer';

/// A project with a page (with a heading) and a fresh user who joins it with `role`.
async function seedDocs(api: Api, role: Role) {
    const project = (await api.createProject()).key;
    const page = await api.post<Keyed>(`/projects/${project}/docs`, {
        kind: 'Page',
        title: `Runbook ${project}`,
        content:
            '# Restart\n\nRestart the payment service.\n\n# Rollback\n\nRoll back the release.',
    });
    const user = await seedUser(api, `docs-tour-${role.toLowerCase()}`);
    await api.post(`/projects/${project}/members`, { user: user.id, role });
    return { project, page: page.key, user };
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
        await expect(
            this.page.locator(`[data-tour="${steps[index].anchor}"]`).first(),
        ).toBeVisible();
    }

    /// Walks forward with → from the first step to the last, checking each one; `shoot` names the
    /// screenshot of the step with that id.
    async walk(steps: readonly TourStep[], shoot: Record<string, string> = {}): Promise<void> {
        for (let i = 0; i < steps.length; i++) {
            if (i > 0) await this.page.keyboard.press('ArrowRight');
            await this.expectStep(steps, i);
            const name = shoot[steps[i].id];
            if (name) await shot(this.page, name);
        }
    }
}

/// With E2E_SCREENSHOTS=1, writes the page in both themes to docs/screenshots.
async function shot(page: Page, name: string): Promise<void> {
    if (!SHOTS) return;
    await page.waitForTimeout(300);
    for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(150);
        await page.screenshot({ path: `../docs/screenshots/tkt-89-${name}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
}

async function startFromHelpMenu(page: Page, shell: ShellPage): Promise<void> {
    await shell.helpTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(shell.helpItem('help-tour-page')).toBeEnabled();
    await page.keyboard.press('ArrowDown');
    await expect(shell.helpItem('help-tour-page')).toBeFocused();
    await page.keyboard.press('Enter');
}

const forAccess = (tour: TourDefinition, canWrite: boolean) =>
    tour.steps.filter((s) => !s.requires || (canWrite && s.requires === 'write'));

test.describe('docs tours', () => {
    test('the palette opens the Docs home of the project in context and a Member walks its tour', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedDocs(api, 'Member');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const tour = new TourCard(page, DOCS_HOME_TOUR);
        const steps = forAccess(DOCS_HOME_TOUR, true);
        await page.goto(`/projects/${seeded.project}/backlog`);
        await shell.expectVisible();

        // Act
        await shell.paletteTrigger.click();
        await page.getByTestId('command-palette-input').fill('docs tour');
        await shell.palette.getByTestId('palette-item-command:help.tour.docs.home').click();

        // Assert: the docs home opened and every step but the Owners' trash shows
        await expect(page).toHaveURL(new RegExp(`/projects/${seeded.project}/docs$`));
        expect(steps.map((s) => s.id)).not.toContain('trash');
        await tour.walk(steps, { tree: 'docs-home-tour' });

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(tour.root).toBeHidden();
        await expect
            .poll(async () => storedTour(context.request, DOCS_HOME_TOUR))
            .toMatchObject({ state: 'Dismissed', version: DOCS_HOME_TOUR.version });
        await context.close();
    });

    test('a Member walks the doc tour on a page and completes it', async ({ browser, api }) => {
        // Arrange
        const seeded = await seedDocs(api, 'Member');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const tour = new TourCard(page, DOCS_DOC_TOUR);
        const steps = DOCS_DOC_TOUR.steps;
        await page.goto(`/projects/${seeded.project}/docs/${seeded.page}`);
        await expect(page.getByTestId('doc-content')).toBeVisible();
        await expect(page.locator('[data-tour="docs.comments"]')).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert
        await expect(page.getByRole('dialog', { name: steps[0].title })).toHaveAttribute(
            'aria-modal',
            'true',
        );
        await tour.walk(steps, { edit: 'doc-tour' });

        // Act: Done on the last step
        const done = tour.root.getByTestId('tour-next');
        await expect(done).toHaveText(/Done/);
        await done.click();

        // Assert
        await expect(tour.root).toBeHidden();
        await expect
            .poll(async () => storedTour(context.request, DOCS_DOC_TOUR))
            .toMatchObject({ state: 'Completed', version: DOCS_DOC_TOUR.version });
        await context.close();
    });

    test('a Viewer gets the doc tour without Edit', async ({ browser, api }) => {
        // Arrange
        const seeded = await seedDocs(api, 'Viewer');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const tour = new TourCard(page, DOCS_DOC_TOUR);
        const steps = forAccess(DOCS_DOC_TOUR, false);
        await page.goto(`/projects/${seeded.project}/docs/${seeded.page}`);
        await expect(page.getByTestId('doc-content')).toBeVisible();
        await expect(page.locator('[data-tour="docs.comments"]')).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert
        expect(steps.map((s) => s.id)).not.toContain('edit');
        await expect(page.locator('[data-tour="docs.edit"]')).toHaveCount(0);
        await tour.walk(steps);
        await page.keyboard.press('Escape');
        await expect(tour.root).toBeHidden();
        await context.close();
    });

    test('the search tour runs in the Docs scope without the export step', async ({
        browser,
        api,
    }) => {
        // Arrange
        const seeded = await seedDocs(api, 'Viewer');
        const { context, page } = await signInAs(browser, {
            email: seeded.user.email,
            password: PASSWORD,
        });
        const shell = new ShellPage(page);
        const tour = new TourCard(page, SEARCH_TOUR);
        const steps = SEARCH_TOUR.steps.filter((s) => s.id !== 'export');
        await page.goto(`/search?scope=docs&q=${encodeURIComponent('Runbook')}`);
        await expect(page.getByTestId('doc-search')).toBeVisible();

        // Act
        await startFromHelpMenu(page, shell);

        // Assert
        await expect(page.locator('[data-tour="search.export"]')).toHaveCount(0);
        await tour.walk(steps, { scope: 'search-docs-tour' });
        await page.keyboard.press('Escape');
        await expect(tour.root).toBeHidden();
        await context.close();
    });
});
