import { randomUUID } from 'node:crypto';
import { ProjectPage } from '../../pages/project.page';
import { ProjectsPage } from '../../pages/projects.page';
import { uniqueProjectKey } from '../../support/api';
import { expect, test } from '../../support/fixtures';

test.describe('projects', () => {
    test('create a project, edit its settings, archive it and see it read-only', async ({
        page,
        shell,
    }) => {
        // Arrange
        const projects = new ProjectsPage(page);
        const project = new ProjectPage(page);
        const key = uniqueProjectKey('P');
        await projects.goto();

        // Act: create through the dialog
        await projects.openNewProject();
        await projects.nameInput.fill(`Customer Portal ${key}`);
        await expect(projects.keyInput).toHaveValue(/^CP[A-Z0-9]*$/);
        await projects.keyInput.fill('1ab');
        await expect(projects.keyError).toHaveText('The key must start with a letter.');
        await projects.keyInput.fill(key.toLowerCase());
        await expect(projects.keyInput).toHaveValue(key);
        await projects.visibilityCard('Public').click();
        await expect(projects.visibilityCard('Public')).toHaveAttribute('aria-checked', 'true');
        await projects.submit.click();

        // Assert: it opens and is in the sidebar
        await expect(page).toHaveURL(new RegExp(`/projects/${key}/`));
        await expect(project.headerName).toHaveText(`Customer Portal ${key}`);
        await expect(project.headerVisibility).toContainText('Public');
        await expect(shell.navLink(`nav-project-${key}`)).toBeVisible();

        // Act: edit settings
        await project.tab('settings').click();
        await project.nameInput.fill(`Portal ${key}`);
        await project.descriptionEditor.fill('Self-service portal for **customers**.');
        await project.saveButton.click();

        // Assert: header and sidebar follow
        await expect(project.headerName).toHaveText(`Portal ${key}`);
        await expect(shell.navLink(`nav-project-${key}`)).toContainText(`Portal ${key}`);
        await expect(project.saveButton).toBeDisabled();

        // Act: archive
        await project.archive();

        // Assert: read-only everywhere
        await expect(project.archivedBanner).toBeVisible();
        await expect(project.nameInput).toBeDisabled();
        await expect(shell.navLink(`nav-project-${key}`)).toHaveCount(0);
        await project.tab('backlog').click();
        await expect(project.archivedBanner).toBeVisible();
        await expect(project.archivedBanner).toContainText('unlinked from every board');

        // Act: unarchive from the banner
        await project.unarchiveButton.click();

        // Assert: boards are not relinked, and the user is told so
        await expect(page.getByText('Its former boards are not linked again')).toBeVisible();
        await expect(project.archivedBanner).toBeHidden();
        await expect(shell.navLink(`nav-project-${key}`)).toBeVisible();
    });

    test('add a member, change the role and remove them', async ({ page, api }) => {
        // Arrange
        const usersApi = await page.request.get('/api/v1/users?query=a');
        test.skip(
            usersApi.status() === 404,
            'Needs the identity slice (GET /users, POST /admin/users) on the same build.',
        );
        const project = new ProjectPage(page);
        const created = await api.createProject();
        const email = `member-${randomUUID()}@ticketing.test`;
        await api.post('/admin/users', { email, displayName: `Mia Member ${created.key}` });
        await project.gotoSettings(created.key);

        // Act
        await project.addMember(email.slice(0, 15), email, 'Viewer');

        // Assert
        await expect(project.memberRow(email)).toBeVisible();
        await expect(project.memberRoleSelect(email)).toContainText('Viewer');

        // Act: promote, then remove
        await project.chooseOption(project.memberRoleSelect(email), 'Member');
        await expect(project.memberRoleSelect(email)).toContainText('Member');
        await page.getByTestId(`member-remove-${email}`).click();

        // Assert
        await expect(project.memberRow(email)).toHaveCount(0);
        await expect
            .poll(async () =>
                (await api.get<{ email: string }[]>(`/projects/${created.key}/members`)).map(
                    (m) => m.email,
                ),
            )
            .not.toContain(email);
    });

    test('an admin deletes an archived project after typing its key', async ({ page, api }) => {
        // Arrange
        const projects = new ProjectsPage(page);
        const project = new ProjectPage(page);
        const created = await api.createProject();
        await api.post(`/projects/${created.key}/archive`);
        await project.gotoSettings(created.key);
        await expect(project.archivedBanner).toBeVisible();

        // Act
        await project.deleteButton.click();
        await expect(project.confirmOk).toBeDisabled();
        await project.confirmText.fill(created.key);
        await project.confirmOk.click();

        // Assert
        await expect(page).toHaveURL(/\/projects$/);
        await projects.view.waitFor();
        await expect(projects.row(created.key)).toHaveCount(0);
    });
});
