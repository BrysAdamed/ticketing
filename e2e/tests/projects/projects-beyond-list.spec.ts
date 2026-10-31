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
});
