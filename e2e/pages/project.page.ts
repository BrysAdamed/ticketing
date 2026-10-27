import { Locator, Page } from '@playwright/test';

/// A project's frame (breadcrumb, archived banner, sidebar sections) and its Settings section.
export class ProjectPage {
    readonly breadcrumbProject: Locator;
    readonly archivedBanner: Locator;
    readonly unarchiveButton: Locator;
    readonly settings: Locator;
    readonly nameInput: Locator;
    readonly descriptionEditor: Locator;
    readonly saveButton: Locator;
    readonly memberUserInput: Locator;
    readonly memberRole: Locator;
    readonly memberAddButton: Locator;
    readonly archiveButton: Locator;
    readonly deleteButton: Locator;
    readonly confirmText: Locator;
    readonly confirmOk: Locator;

    constructor(private readonly page: Page) {
        this.breadcrumbProject = page.getByTestId('breadcrumb-project');
        this.archivedBanner = page.getByTestId('project-archived-banner');
        this.unarchiveButton = page.getByTestId('project-unarchive');
        this.settings = page.getByTestId('view-project.settings');
        this.nameInput = page.getByTestId('settings-name');
        this.descriptionEditor = page.getByTestId('settings-description').locator('textarea');
        this.saveButton = page.getByTestId('settings-save');
        this.memberUserInput = page.getByTestId('member-add-user');
        this.memberRole = page.getByTestId('member-add-role');
        this.memberAddButton = page.getByTestId('member-add-submit');
        this.archiveButton = page.getByTestId('settings-archive');
        this.deleteButton = page.getByTestId('settings-delete');
        this.confirmText = page.getByTestId('confirm-text');
        this.confirmOk = page.getByTestId('confirm-ok');
    }

    async gotoSettings(key: string): Promise<void> {
        await this.page.goto(`/projects/${key}/settings`);
        await this.settings.waitFor();
        await this.nameInput.waitFor();
    }

    section(path: string): Locator {
        return this.page.getByTestId('sidebar').getByTestId(`nav-project-${path}`);
    }

    memberRow(email: string): Locator {
        return this.page.getByTestId(`member-row-${email}`);
    }

    memberRoleSelect(email: string): Locator {
        return this.page.getByTestId(`member-role-${email}`);
    }

    async chooseOption(select: Locator, label: string): Promise<void> {
        await select.click();
        await this.page.getByRole('option', { name: label, exact: true }).click();
    }

    async addMember(search: string, email: string, role: string): Promise<void> {
        await this.memberUserInput.fill(search);
        await this.page.getByTestId(`member-add-option-${email}`).click();
        await this.chooseOption(this.memberRole, role);
        await this.memberAddButton.click();
    }

    async archive(): Promise<void> {
        await this.archiveButton.click();
        await this.confirmOk.click();
    }
}
