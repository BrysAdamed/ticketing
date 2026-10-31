import { Page } from '@playwright/test';
import { BoardPage } from '../../pages/board.page';
import { ProjectsPage } from '../../pages/projects.page';
import { uniqueProjectKey } from '../../support/api';
import { expect, test } from '../../support/fixtures';

const PAGE_SIZE = 100;

/// Makes the unfiltered project list endless, so the browser sees more projects than it loads
/// (D-168) whatever the size of the stack. Filtered requests (`query`) reach the real API.
async function simulateManyProjects(page: Page): Promise<void> {
    await page.route(
        (url) => url.pathname === '/api/v1/projects' && !url.searchParams.has('query'),
        async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            const url = new URL(route.request().url());
            const start = Number(url.searchParams.get('cursor')?.slice(2) ?? -1) + 1;
            const items = Array.from({ length: PAGE_SIZE }, (_, i) => {
                const key = `AA${String(start + i).padStart(5, '0')}`;
                return {
                    id: `00000000-0000-4000-8000-${String(start + i).padStart(12, '0')}`,
                    key,
                    name: `Filler ${key}`,
                    visibility: 'Public',
                    myRole: 'Member',
                    isMember: false,
                    archivedAt: null,
                };
            });
            await route.fulfill({ json: { items, nextCursor: items[items.length - 1].key } });
        },
    );
}

test.describe('more projects than the lists load', () => {
    test('the projects page says the list is cut and finds a later project by search', async ({
        page,
        api,
    }) => {
        // Arrange
        const key = uniqueProjectKey();
        const project = await api.createProject({ key, name: `Beyond the first thousand ${key}` });
        await simulateManyProjects(page);
        const projects = new ProjectsPage(page);

        // Act
        await projects.goto();

        // Assert
        await expect(page.getByTestId('projects-capped')).toContainText('first 1000 projects');
        await expect(page.getByTestId('projects-count')).toHaveText('1000+');
        await expect(projects.row(project.key)).toHaveCount(0);

        // Act
        await projects.filter.fill(project.key);

        // Assert
        await expect(projects.row(project.key)).toBeVisible();
        await expect(projects.row(project.key)).toContainText('Beyond the first thousand');
        await expect(page.getByTestId('projects-capped')).toBeHidden();
    });

    test('the New board dialog and the palette find a later project by search', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject();
        await simulateManyProjects(page);
        const boards = new BoardPage(page);
        await boards.gotoList();

        // Act: palette
        await page.keyboard.press('ControlOrMeta+k');
        await page.getByTestId('command-palette-input').fill(project.key);
        await page.getByTestId(`palette-item-project:${project.key}`).click();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/projects/${project.key}/`));

        // Act: New board
        await boards.gotoList();
        await page.getByTestId('boards-new').click();
        await expect(page.getByTestId('create-board-projects-capped')).toBeVisible();
        const dialog = page.getByTestId('create-board-dialog');
        await dialog.getByTestId('create-board-name').fill(`Beyond ${project.key}`);
        await dialog.getByTestId('create-board-project-filter').fill(project.key);
        await dialog.getByTestId(`create-board-project-${project.key}`).click();
        await dialog.getByTestId('create-board-submit').click();

        // Assert
        await expect(boards.name).toHaveText(`Beyond ${project.key}`);
    });

    test('the Create ticket dialog shows a prefilled later project and finds another by search', async ({
        page,
        api,
    }) => {
        // Arrange
        const first = await api.createProject({ name: `Prefilled ${uniqueProjectKey()}` });
        const other = await api.createProject({ name: `Picked ${uniqueProjectKey()}` });
        await simulateManyProjects(page);
        await page.goto(`/projects/${first.key}/backlog`);

        // Act
        await page.getByTestId('new-ticket').click();
        const dialog = page.getByTestId('create-ticket-dialog');

        // Assert
        await expect(dialog.getByTestId('create-project')).toContainText(first.name);

        // Act
        await dialog.getByTestId('create-project').click();
        await expect(page.getByTestId('search-picker-hint')).toContainText('first 1000 projects');
        await page.getByTestId('search-picker-input').fill(other.key);
        await page.keyboard.press('Enter');
        await expect(dialog.getByTestId('create-project')).toContainText(other.name);
        await dialog.getByTestId('create-title').fill('Filed beyond the first thousand');
        await dialog.getByTestId('create-submit').click();

        // Assert
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText(new RegExp(`${other.key}-\\d+ created`))).toBeVisible();
    });

    test('board settings link a later project found by search', async ({ page, api }) => {
        // Arrange
        const linked = await api.createProject();
        const later = await api.createProject();
        const board = await api.post<{ id: string }>('/boards', {
            name: `Settings ${linked.key}`,
            projectKeys: [linked.key],
        });
        await simulateManyProjects(page);
        const boards = new BoardPage(page);
        await boards.goto(board.id);

        // Act
        await page.getByTestId('board-settings').click();
        const dialog = page.getByTestId('board-settings-dialog');
        await dialog.getByTestId('settings-link-project').click();
        await expect(page.getByTestId('search-picker-hint')).toBeVisible();
        await page.getByTestId('search-picker-input').fill(later.key);
        await page.keyboard.press('Enter');
        await expect(dialog.getByTestId('settings-link-project')).toContainText(later.key);
        await dialog.getByTestId('settings-link').click();

        // Assert
        await expect(dialog.getByTestId(`settings-project-${later.key}`)).toBeVisible();
    });

    test('the search project facets find a later project and keep it listed once chosen', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject({ name: `Facet ${uniqueProjectKey()}` });
        await simulateManyProjects(page);
        await page.goto('/search');

        // Act
        await page.getByTestId('filter-project').click();
        await expect(page.getByTestId('filter-project-capped')).toContainText('first 1000');
        await page.getByTestId('filter-project-input').fill(project.key);
        await page.getByTestId(`filter-project-${project.key}`).click();
        await page.keyboard.press('Escape');

        // Assert
        await expect(page).toHaveURL(new RegExp(`project=${project.key}`));
        await expect(page.getByTestId('filter-project')).toContainText(project.key);

        // Act: reopen after a reload, nothing typed
        await page.reload();
        await page.getByTestId('filter-project').click();

        // Assert
        await expect(page.getByTestId(`filter-project-${project.key}`)).toBeVisible();
        await page.keyboard.press('Escape');

        // Act: the docs scope
        await page.goto('/search?scope=docs');
        await page.getByTestId('doc-filter-project').click();
        await expect(page.getByTestId('doc-filter-project-capped')).toBeVisible();
        await page.getByTestId('doc-filter-project-input').fill(project.key);

        // Assert
        await expect(page.getByTestId(`doc-filter-project-${project.key}`)).toBeVisible();
    });

    test('notification preferences mute a later project found by search', async ({
        page,
        api,
    }) => {
        // Arrange
        const project = await api.createProject();
        await simulateManyProjects(page);
        await page.goto('/profile/notifications');
        await expect(page.getByTestId('notification-kind-Commented')).toBeVisible();

        // Act
        await page.getByTestId('notification-mute-project').click();
        await expect(page.getByTestId('search-picker-hint')).toBeVisible();
        await page.getByPlaceholder('Find a project…').fill(project.key);
        await page.keyboard.press('Enter');

        // Assert
        await expect(page.getByTestId(`notification-muted-${project.key}`)).toBeVisible();
        await api.patch('/me/notification-preferences', { unmuteProjects: [project.key] });
    });
});
