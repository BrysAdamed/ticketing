import { Locator, Page } from '@playwright/test';

/// Project settings → Agent: the delegation setup card, the prompt list and the prompt editor.
export class AgentSettingsPage {
    readonly tab: Locator;
    readonly view: Locator;
    readonly enabled: Locator;
    readonly repositoryUrl: Locator;
    readonly repositoryUrlError: Locator;
    readonly repositoryUrlNormalized: Locator;
    readonly mergeWhenVerified: Locator;
    readonly mergeReview: Locator;
    readonly mergeWarning: Locator;
    readonly saveSetup: Locator;

    readonly editor: Locator;
    readonly chip: Locator;
    readonly body: Locator;
    readonly completion: Locator;
    readonly issueMark: Locator;
    readonly changeNote: Locator;
    readonly save: Locator;
    readonly reset: Locator;
    readonly back: Locator;
    readonly preview: Locator;
    readonly previewGuardrails: Locator;
    readonly diff: Locator;
    readonly confirmOk: Locator;
    readonly confirmCancel: Locator;

    constructor(private readonly page: Page) {
        this.tab = page.getByTestId('project-settings-tab-agent');
        this.view = page.getByTestId('view-project.settings.agent');
        this.enabled = page.getByTestId('agent-enabled').getByRole('switch');
        this.repositoryUrl = page.getByTestId('agent-repository-url');
        this.repositoryUrlError = page.getByTestId('agent-repository-url-error');
        this.repositoryUrlNormalized = page.getByTestId('agent-repository-url-normalized');
        this.mergeWhenVerified = page
            .getByTestId('agent-merge-policy-MergeWhenVerified')
            .getByRole('radio');
        this.mergeReview = page.getByTestId('agent-merge-policy-Review').getByRole('radio');
        this.mergeWarning = page.getByTestId('agent-merge-policy-warning');
        this.saveSetup = page.getByTestId('agent-setup-save');

        this.editor = page.getByTestId('view-project.settings.agent-prompt');
        this.chip = page.getByTestId('agent-prompt-chip');
        this.body = page.getByTestId('agent-prompt-body-input');
        this.completion = page.getByTestId('agent-prompt-body-completion');
        this.issueMark = page.getByTestId('template-issue-mark');
        this.changeNote = page.getByTestId('agent-prompt-change-note');
        this.save = page.getByTestId('agent-prompt-save');
        this.reset = page.getByTestId('agent-prompt-reset');
        this.back = page.getByTestId('agent-prompt-back');
        this.preview = page.getByTestId('prompt-preview-text');
        this.previewGuardrails = page.getByTestId('prompt-preview-muted');
        this.diff = page.getByTestId('prompt-diff');
        this.confirmOk = page.getByTestId('confirm-ok');
        this.confirmCancel = page.getByTestId('confirm-cancel');
    }

    async goto(projectKey: string): Promise<void> {
        await this.page.goto(`/projects/${projectKey}/settings/agent`);
        await this.view.waitFor();
    }

    promptRow(type: string): Locator {
        return this.page.getByTestId(`agent-prompt-row-${type}`);
    }

    promptChip(type: string): Locator {
        return this.page.getByTestId(`agent-prompt-chip-${type}`);
    }

    mode(mode: 'Inherit' | 'Custom' | 'Off'): Locator {
        return this.page.getByTestId(`agent-prompt-mode-${mode}`);
    }

    panel(panel: 'preview' | 'compare' | 'history'): Locator {
        return this.page.getByTestId(`agent-prompt-panel-${panel}`);
    }

    historyRow(version: number): Locator {
        return this.page.getByTestId(`prompt-history-row-${version}`);
    }

    restore(version: number): Locator {
        return this.page.getByTestId(`prompt-history-restore-${version}`);
    }

    completionOption(name: string): Locator {
        return this.page.getByTestId(`agent-prompt-body-option-${name}`);
    }
}
