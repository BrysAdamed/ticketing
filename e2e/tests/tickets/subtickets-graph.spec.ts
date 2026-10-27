import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { ADMIN_STORAGE_STATE } from '../../support/env';
import { expect, test } from '../../support/fixtures';

const FLAG = 'ticket.subtickets-graph';

interface TicketSummary {
    key: string;
}

interface Flag {
    key: string;
}

async function setFlag(api: Api, enabled: boolean): Promise<void> {
    const flags = await api.get<Flag[]>('/admin/flags');
    if (!flags.some((f) => f.key === FLAG))
        await api.post('/admin/flags', {
            key: FLAG,
            description: 'Sub-tickets graph (TKT-23)',
            enabled,
            targetRoles: ['Admin'],
        });
    else await api.patch(`/admin/flags/${FLAG}`, { enabled, targetRoles: ['Admin'] });
}

/// An epic shaped like TKT-10, scaled down: A blocks C, B blocks C and D, C blocks E; F is done
/// and blocks nothing.
async function seedEpic(api: Api) {
    const projectKey = (await api.createProject()).key;
    const create = async (title: string, extra: object = {}) =>
        (
            await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
                title,
                type: 'UserStory',
                ...extra,
            })
        ).key;
    const epic = await create('Docs', { type: 'Epic' });
    const [a, b, c, d, e, f] = [
        await create('Spike the pipeline', { parentKey: epic }),
        await create('Backend core', { parentKey: epic }),
        await create('Markdown pages', { parentKey: epic }),
        await create('Search', { parentKey: epic }),
        await create('PDF export', { parentKey: epic }),
        await create('Research', { parentKey: epic, status: 'Done' }),
    ];
    for (const [from, to] of [
        [a, c],
        [b, c],
        [b, d],
        [c, e],
    ])
        await api.post(`/tickets/${from}/links`, { targetKey: to, type: 'Blocks' });
    return { epic, a, b, c, d, e, f };
}

test.describe('sub-tickets graph', () => {
    test.describe.configure({ mode: 'serial' });

    test.afterAll(async () => {
        const api = await Api.create(ADMIN_STORAGE_STATE);
        await setFlag(api, false);
        await api.dispose();
    });

    test('with the flag off the Sub-tickets section is the plain list', async ({ page, api }) => {
        // Arrange
        await setFlag(api, false);
        const { epic, a, f } = await seedEpic(api);
        const ticket = new TicketPage(page);

        // Act
        await ticket.goto(epic);

        // Assert
        const section = ticket.root.getByTestId('ticket-children');
        await expect(section.getByTestId(`child-${a}`)).toBeVisible();
        await expect(section.getByTestId(`child-${f}`)).toBeVisible();
        await expect(section.getByTestId('children-view-graph')).toHaveCount(0);
        await expect(section.getByTestId('children-graph')).toHaveCount(0);
    });

    test('with the flag on the graph shows what blocks what, opens tickets and is remembered', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { epic, a, b, c, d, e, f } = await seedEpic(api);
        const ticket = new TicketPage(page);
        await ticket.goto(epic);
        const section = ticket.root.getByTestId('ticket-children');

        // Act
        await section.getByTestId('children-view-graph').click();

        // Assert: states, critical path and legend
        const graph = section.getByTestId('children-graph');
        const node = (key: string) => graph.getByTestId(`graph-node-${key}`);
        await expect(node(a)).toHaveAttribute('data-state', 'ready');
        await expect(node(b)).toHaveAttribute('data-state', 'ready');
        await expect(node(c)).toHaveAttribute('data-state', 'blocked');
        await expect(node(d)).toHaveAttribute('data-state', 'blocked');
        await expect(node(e)).toHaveAttribute('data-state', 'blocked');
        await expect(node(f)).toHaveAttribute('data-state', 'done');
        await expect(node(a)).toHaveClass(/crit/);
        await expect(node(c)).toHaveClass(/crit/);
        await expect(node(e)).toHaveClass(/crit/);
        await expect(node(d)).not.toHaveClass(/crit/);
        await expect(graph.getByTestId('graph-legend')).toContainText('2 ready');
        await expect(graph.getByTestId('graph-legend')).toContainText('3 blocked');
        await expect(graph.getByTestId('graph-critical')).toContainText('Critical path · 3');
        await expect(node(c)).toHaveAttribute('aria-label', new RegExp(`Blocked by ${a}, ${b}`));

        // Act: hovering highlights up- and downstream only
        await node(c).hover();

        // Assert
        await expect(node(d)).toHaveClass(/dim/);
        await expect(node(a)).not.toHaveClass(/dim/);
        await expect(node(e)).not.toHaveClass(/dim/);

        // Act: keyboard moves between tickets and Enter opens the peek
        await page.mouse.move(0, 0);
        await node(a).focus();
        await page.keyboard.press('ArrowDown');
        await expect(node(c)).toBeFocused();
        await page.keyboard.press('Enter');

        // Assert
        await expect(page).toHaveURL(new RegExp(`peek=${c}`));
        await expect(new TicketPage(page, 'peek').title).toContainText('Markdown pages');

        // Act: the choice survives a reload
        await page.goto(`/tickets/${epic}`);

        // Assert
        await expect(section.getByTestId('children-graph')).toBeVisible();
        await section.getByTestId('children-view-list').click();
        await expect(section.getByTestId(`child-${a}`)).toBeVisible();
        await expect(section.getByTestId('children-graph')).toHaveCount(0);
    });
});
