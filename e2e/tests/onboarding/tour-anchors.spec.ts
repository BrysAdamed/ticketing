import { Page } from '@playwright/test';
import type { TourDefinition } from '@onboarding/engine/tour.model';
import { TOUR_CATALOGUE } from '@onboarding/tours/tour-catalogue';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { ShellPage } from '../../pages/shell.page';

/// A page to open, and the anchors that state of the view leaves out by design (the Docs scope of
/// search has no CSV export).
interface RecipePage {
    readonly url: string;
    readonly without: readonly string[];
}

/// Pages to open for one tour, seeded through the API. Every listed page must show every anchor of
/// the tour except the ones it lists as `without`, so list each state the tour has to work on (an
/// empty and a filled dashboard).
type SeedingRecipe = (api: Api) => Promise<readonly (string | RecipePage)[]>;

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

async function doc(api: Api, projectKey: string, body: Record<string, unknown>) {
    return api.post<Keyed>(`/projects/${projectKey}/docs`, body);
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
        await doc(api, project.key, { kind: 'Page', title: `Anchor search ${project.key}` });
        const docsScope = (q: string) => ({
            url: `/search?scope=docs&q=${q}`,
            without: ['search.export'],
        });
        return [
            `/search?q=${project.key}`,
            `/search?q=nothing-matches-${project.key}`,
            docsScope(project.key),
            docsScope(`nothing-matches-${project.key}`),
        ];
    },
    'docs.home': async (api) => {
        const empty = await api.createProject();
        const filled = await api.createProject();
        await doc(api, filled.key, { kind: 'Page', title: 'Runbook', content: 'Restart it.' });
        return [`/projects/${empty.key}/docs`, `/projects/${filled.key}/docs`];
    },
    'docs.doc': async (api) => {
        const project = await api.createProject();
        const page = await doc(api, project.key, {
            kind: 'Page',
            title: 'Runbook',
            content: '# Restart\n\nRestart the service.',
        });
        const diagram = await doc(api, project.key, {
            kind: 'Diagram',
            diagramFormat: 'Mermaid',
            title: 'Checkout flow',
            content: 'flowchart LR\n  Shop --> Stripe',
        });
        return [
            `/projects/${project.key}/docs/${page.key}`,
            `/projects/${project.key}/docs/${diagram.key}`,
        ];
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

/// Anchors that depend on instance-wide state this spec must not change while other specs run,
/// with the spec that covers them instead. Here they may be absent, but never hidden.
const COVERED_ELSEWHERE: Readonly<Record<string, string>> = {
    'ticket.delegate':
        'needs the instance-wide agent.delegate flag; covered by e2e/tests/agents/delegate-to-agent.spec.ts',
};

/// Asserts every anchor of the tour is visible, except the ones this state leaves out (which must
/// then be absent), and returns how many steps the tour should show.
async function expectEveryAnchor(
    page: Page,
    tour: TourDefinition,
    { url, without }: RecipePage,
): Promise<number> {
    let shown = 0;
    for (const step of tour.steps) {
        const anchor = page.locator(`[data-tour="${step.anchor}"]`);
        if (without.includes(step.anchor)) {
            await expect(anchor, `${url}: anchor "${step.anchor}" should be left out`).toHaveCount(
                0,
            );
            continue;
        }
        if (COVERED_ELSEWHERE[step.anchor] && (await anchor.count()) === 0) continue;
        await expect(
            anchor,
            `${url}: anchor "${step.anchor}" of step "${step.id}" (${tour.id})`,
        ).toBeVisible();
        shown++;
    }
    return shown;
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
            const pages = (await recipe(api)).map((p) =>
                typeof p === 'string' ? { url: p, without: [] } : p,
            );
            const shell = new ShellPage(page);

            for (const recipePage of pages) {
                // Act
                await page.goto(recipePage.url);
                await expect(page.getByTestId(`view-${entry.viewId}`)).toBeVisible();

                // Assert: the Admin (Owner everywhere) sees every anchor, and the tour starts with
                // every step
                const shown = await expectEveryAnchor(page, tour, recipePage);
                await shell.openHelp();
                await shell.helpItem('help-tour-page').click();
                await expect(page.getByTestId('tour-step-count')).toHaveText(
                    `${tour.title} tour · Step 1 of ${shown}`,
                );
                await page.keyboard.press('Escape');
                await expect(page.getByTestId('tour-popover')).toBeHidden();
            }
        });
    }
});
