import { Locator, Page } from '@playwright/test';

/// Admin → Agent prompts: the public URL status, the defaults and guardrails list, the overrides
/// dialog and the instance prompt editor.
export class AdminAgentPromptsPage {
    readonly tab: Locator;
    readonly navLink: Locator;
    readonly view: Locator;
    readonly publicUrlSet: Locator;
    readonly publicUrlMissing: Locator;
    readonly overridesDialog: Locator;

    readonly editor: Locator;
    readonly chip: Locator;
    readonly body: Locator;
    readonly changeNote: Locator;
    readonly save: Locator;
    readonly resetToBuiltIn: Locator;
    readonly back: Locator;
    readonly preview: Locator;
    readonly previewMuted: Locator;
    readonly confirmOk: Locator;

    constructor(private readonly page: Page) {
        this.tab = page.getByTestId('admin-tab-agent-prompts');
        this.navLink = page.getByTestId('nav-admin-agent-prompts');
        this.view = page.getByTestId('view-admin.agent-prompts');
        this.publicUrlSet = page.getByTestId('agent-public-url-set');
        this.publicUrlMissing = page.getByTestId('agent-public-url-missing');
        this.overridesDialog = page.getByTestId('agent-overrides-dialog');

        this.editor = page.getByTestId('view-admin.agent-prompt');
        this.chip = page.getByTestId('agent-prompt-chip');
        this.body = page.getByTestId('agent-prompt-body-input');
        this.changeNote = page.getByTestId('agent-prompt-change-note');
        this.save = page.getByTestId('agent-prompt-save');
        this.resetToBuiltIn = page.getByTestId('agent-prompt-reset-built-in');
        this.back = page.getByTestId('agent-prompt-back');
        this.preview = page.getByTestId('prompt-preview-text');
        this.previewMuted = page.getByTestId('prompt-preview-muted');
        this.confirmOk = page.getByTestId('confirm-ok');
    }

    async goto(): Promise<void> {
        await this.page.goto('/admin/agent-prompts');
        await this.view.waitFor();
    }

    row(slot: string): Locator {
        return this.page.getByTestId(`agent-default-row-${slot}`);
    }

    link(slot: string): Locator {
        return this.page.getByTestId(`agent-default-link-${slot}`);
    }

    rowChip(slot: string): Locator {
        return this.page.getByTestId(`agent-default-chip-${slot}`);
    }

    overrides(slot: string): Locator {
        return this.page.getByTestId(`agent-default-overrides-${slot}`);
    }

    override(projectKey: string): Locator {
        return this.overridesDialog.getByTestId(`agent-override-${projectKey}`);
    }
}
