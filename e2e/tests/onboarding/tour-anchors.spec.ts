import { Page } from '@playwright/test';
import type { TourDefinition } from '@onboarding/engine/tour.model';
import { TOUR_CATALOGUE } from '@onboarding/tours/tour-catalogue';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { ShellPage } from '../../pages/shell.page';

/// Pages to open for one tour, seeded through the API. Every listed page must show every anchor of
/// the tour, so list each state the tour has to work on (an empty and a filled dashboard).
type SeedingRecipe = (api: Api) => Promise<readonly string[]>;

interface Keyed {
    key: string;
}

async function ticket(api: Api, projectKey: string, title: string, extra: object = {}) {
    return api.post<Keyed & { id: string }>(`/projects/${projectKey}/tickets`, {
        title,
        type: 'UserStory',
        ...extra,
    });
}

async function board(api: Api, projectKey: string) {
    return api.post<{ id: string }>('/boards', {
        name: `Anchors ${projectKey}`,
        projectKeys: [projectKey],
    });
}

async function regressionSession(api: Api, projectKey: string) {
    await api.post(`/projects/${projectKey}/test-cases`, {
        title: 'Sign in with a valid password',
        status: 'Manual',
        steps: ['Open the sign-in page', 'Enter valid credentials'],
    });
    return api.post<Keyed>(`/projects/${projectKey}/regression-sessions`, { name: 'Anchors' });
}

/// One recipe per view id in `TOUR_CATALOGUE`. A tour added without a recipe fails this spec
/// (docs/development/frontend.md, "Adding a tour").
const RECIPES: Readonly<Record<string, SeedingRecipe>> = {
    'backlog.list': async (api) => {
        const project = await api.createProject();
        await ticket(api, project.key, 'Checkout total');
        const placed = await ticket(api, project.key, 'Login banner');
        const target = await board(api, project.key);
        await api.post('/tickets/move', { keys: [placed.key], target: target.id });
        return [`/projects/${project.key}/backlog`];
    },
    'project.dashboard': async (api) => {
        const empty = await api.createProject();
        const filled = await api.createProject();
        const epic = await ticket(api, filled.key, 'Checkout', { type: 'Epic' });
        await ticket(api, filled.key, 'Pay by card', { parentKey: epic.key });
        return [`/projects/${empty.key}/dashboard`, `/projects/${filled.key}/dashboard`];
    },
    'search.results': async (api) => {
        const project = await api.createProject();
        await ticket(api, project.key, `Anchor search ${project.key}`);
        return [`/search?q=${project.key}`, `/search?q=nothing-matches-${project.key}`];
    },
    'testcases.list': async (api) => {
        const project = await api.createProject();
        await regressionSession(api, project.key);
        return [`/projects/${project.key}/test-cases`];
    },
    'regressions.session': async (api) => {
        const project = await api.createProject();
        const session = await regressionSession(api, project.key);
        return [`/projects/${project.key}/regressions/${session.key}`];
    },
    'project.settings': async (api) => {
        const project = await api.createProject();
        return [`/projects/${project.key}/settings`];
    },
    'admin.users': async () => ['/admin/users'],
    'board.kanban': async (api) => {
        const project = await api.createProject();
        const placed = await ticket(api, project.key, 'On the board');
        const target = await board(api, project.key);
        await api.post('/tickets/move', { keys: [placed.key], target: target.id });
        return [`/boards/${target.id}`];
    },
    'ticket.detail': async (api) => {
        const project = await api.createProject();
        const parent = await ticket(api, project.key, 'Parent story');
        await ticket(api, project.key, 'Sub-ticket', { parentKey: parent.key });
        return [`/tickets/${parent.key}`];
    },
};

async function expectEveryAnchor(page: Page, tour: TourDefinition, url: string): Promise<void> {
    for (const step of tour.steps) {
        await expect(
            page.locator(`[data-tour="${step.anchor}"]`),
            `${url}: anchor "${step.anchor}" of step "${step.id}" (${tour.id})`,
        ).toBeVisible();
    }
}

test.describe('tour anchors', () => {
    for (const entry of TOUR_CATALOGUE) {
        test(`every anchor of the ${entry.viewId} tour is on the page`, async ({ page, api }) => {
            // Arrange
            const recipe = RECIPES[entry.viewId];
            expect(
                recipe,
                `No seeding recipe for the "${entry.viewId}" tour: add one to RECIPES in e2e/tests/onboarding/tour-anchors.spec.ts`,
            ).toBeDefined();
            const tour = await entry.load();
            const routed = tour.steps.filter((s) => s.route);
            expect(
                routed.map((s) => s.id),
                `${tour.id}: steps on another route are not covered by this spec yet`,
            ).toEqual([]);
            const urls = await recipe(api);
            const shell = new ShellPage(page);

            for (const url of urls) {
                // Act
                await page.goto(url);
                await expect(page.getByTestId(`view-${entry.viewId}`)).toBeVisible();

                // Assert: the Admin (Owner everywhere) sees every anchor, and the tour starts with
                // every step
                await expectEveryAnchor(page, tour, url);
                await shell.openHelp();
                await shell.helpItem('help-tour-page').click();
                await expect(page.getByTestId('tour-step-count')).toHaveText(
                    `${tour.title} tour · Step 1 of ${tour.steps.length}`,
                );
                await page.keyboard.press('Escape');
                await expect(page.getByTestId('tour-popover')).toBeHidden();
            }
        });
    }
});
