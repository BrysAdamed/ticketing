import { Locator, Page } from '@playwright/test';

/// `/projects`: the project list and the "New project" dialog.
export class ProjectsPage {
    readonly view: Locator;
    readonly newButton: Locator;
    readonly filter: Locator;
    readonly dialog: Locator;
    readonly nameInput: Locator;
    readonly keyInput: Locator;
    readonly keyError: Locator;
    readonly descriptionInput: Locator;
    readonly submit: Locator;

    constructor(private readonly page: Page) {
        this.view = page.getByTestId('view-projects.list');
        this.newButton = page.getByTestId('projects-new');
        this.filter = page.getByTestId('projects-filter');
        this.dialog = page.getByTestId('new-project-form');
        this.nameInput = page.getByTestId('new-project-name');
        this.keyInput = page.getByTestId('new-project-key');
        this.keyError = page.getByTestId('new-project-key-error');
        this.descriptionInput = page.getByTestId('new-project-description');
        this.submit = page.getByTestId('new-project-submit');
    }

    async goto(): Promise<void> {
        await this.page.goto('/projects');
        await this.view.waitFor();
    }

    row(key: string): Locator {
        return this.page.getByTestId(`project-row-${key}`);
    }

    visibilityCard(visibility: 'Private' | 'Public'): Locator {
        return this.dialog.getByTestId(`visibility-${visibility}`);
    }

    async openNewProject(): Promise<void> {
        await this.newButton.click();
        await this.dialog.waitFor();
    }
}
