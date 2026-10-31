import { Page } from '@playwright/test';
import { AdminAgentPromptsPage } from '../../pages/admin-agent-prompts.page';
import { AgentSettingsPage } from '../../pages/agent-settings.page';
import { DelegatePage } from '../../pages/delegate.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { ADMIN_STORAGE_STATE } from '../../support/env';
import { expect, test } from '../../support/fixtures';

const FLAG = 'agent.delegate';
const REPOSITORY = 'https://git.example.com/team/admin-prompts-e2e.git';

declare global {
    interface Window {
        __tkCopied?: string[];
    }
}

interface Flag {
    key: string;
}

interface TicketSummary {
    key: string;
}

interface InstancePrompt {
    version: number;
    followsBuiltIn: boolean;
}

async function setFlag(api: Api, enabled: boolean): Promise<void> {
    const flags = await api.get<Flag[]>('/admin/flags');
    if (!flags.some((f) => f.key === FLAG))
        await api.post('/admin/flags', {
            key: FLAG,
            description: 'Delegate to agent (TKT-25)',
            enabled,
            targetRoles: ['Admin'],
        });
    else await api.patch(`/admin/flags/${FLAG}`, { enabled, targetRoles: ['Admin'] });
}

/// Puts the guardrails back on the shipped built-in so other agent specs see the default text.
async function resetGuardrails(api: Api): Promise<void> {
    const guardrails = await api.get<InstancePrompt>('/admin/agent/prompts/guardrails');
    if (!guardrails.followsBuiltIn)
        await api.post('/admin/agent/prompts/guardrails/reset-built-in', {
            baseVersion: guardrails.version,
        });
}

async function seed(api: Api): Promise<{ projectKey: string; ticketKey: string }> {
    const projectKey = (await api.createProject()).key;
    await api.patch(`/projects/${projectKey}/agent`, { enabled: true, repositoryUrl: REPOSITORY });
    const ticketKey = (
        await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Guardrails reach every prompt',
            type: 'Bug',
        })
    ).key;
    return { projectKey, ticketKey };
}

/// Records what the CDK clipboard copies (a temporary textarea and `execCommand('copy')`) instead
/// of touching the machine's clipboard.
async function recordCopies(page: Page): Promise<void> {
    await page.addInitScript(() => {
        window.__tkCopied = [];
        const execCommand = document.execCommand.bind(document);
        document.execCommand = (command: string, ...rest: unknown[]) => {
            if (command !== 'copy') return execCommand(command, ...(rest as [boolean, string]));
            const source = document.body.lastElementChild;
            window.__tkCopied!.push(source instanceof HTMLTextAreaElement ? source.value : '');
            return true;
        };
    });
}

test.describe('admin agent prompts', () => {
    test.describe.configure({ mode: 'serial' });

    test.afterAll(async () => {
        const api = await Api.create(ADMIN_STORAGE_STATE);
        await setFlag(api, true);
        await resetGuardrails(api);
        await setFlag(api, false);
        await api.dispose();
    });

    test('with the flag off there is no Agent prompts tab and no page', async ({ page, api }) => {
        // Arrange
        await setFlag(api, false);
        const admin = new AdminAgentPromptsPage(page);

        // Act
        await page.goto('/admin/flags');

        // Assert
        await expect(page.getByTestId('admin-tab-flags')).toBeVisible();
        await expect(admin.tab).toHaveCount(0);
        await expect(admin.navLink).toHaveCount(0);
        await page.goto('/admin/agent-prompts');
        await expect(page.getByTestId('view-app.not-found')).toBeVisible();
        await expect(admin.view).toHaveCount(0);
    });

    test('the page shows the public URL, the defaults with their overrides and the guardrails', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { projectKey } = await seed(api);
        await api.put(`/projects/${projectKey}/agent/prompts/Bug`, {
            mode: 'Custom',
            body: 'Our own bug prompt for {{ticket.key}}.',
            baseVersion: 0,
        });
        const admin = new AdminAgentPromptsPage(page);
        await page.goto('/admin/flags');

        // Act
        await expect(admin.navLink).toBeVisible();
        await admin.tab.click();
        await admin.view.waitFor();

        // Assert
        await expect(admin.publicUrlSet).toContainText('TICKETING_PUBLIC_URL');
        await expect(admin.publicUrlMissing).toHaveCount(0);
        for (const slot of ['Epic', 'UserStory', 'Technical', 'Spike', 'Bug', 'Guardrails'])
            await expect(admin.row(slot)).toBeVisible();
        await expect(admin.overrides('Bug')).toContainText(/\d+ projects? overrides?/);

        // Act
        await admin.overrides('Bug').click();

        // Assert
        await expect(admin.override(projectKey)).toContainText('Custom v1');

        // Act: the project row leads to that project's Bug prompt
        await admin.override(projectKey).getByRole('link').click();

        // Assert
        await expect(page).toHaveURL(new RegExp(`/projects/${projectKey}/settings/agent/bug$`));
        await expect(page.getByTestId('view-project.settings.agent-prompt')).toBeVisible();
    });

    test('edited guardrails are appended to a project prompt preview and to Copy prompt', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        await resetGuardrails(api);
        const { projectKey, ticketKey } = await seed(api);
        const marker = `Never print secrets from .env files (${Date.now()}).`;
        const admin = new AdminAgentPromptsPage(page);
        await admin.goto();

        // Act
        await admin.link('Guardrails').click();
        await admin.editor.waitFor();
        await expect(admin.chip).toContainText('Built-in');
        await admin.body.press('Control+End');
        await admin.body.pressSequentially(`\n${marker}`);

        // Assert: the preview shows the new guardrails after a greyed sample type prompt
        await expect(admin.preview).toContainText(marker);
        await expect(admin.previewMuted).not.toContainText(marker);

        // Act
        await admin.changeNote.fill('No secrets in output');
        await admin.save.click();

        // Assert
        await expect(admin.chip).toContainText('Edited');
        await expect(admin.resetToBuiltIn).toBeVisible();

        // Act: a project's prompt editor previews its type prompt with the guardrails greyed below
        const agent = new AgentSettingsPage(page);
        await page.goto(`/projects/${projectKey}/settings/agent/bug`);
        await agent.editor.waitFor();

        // Assert
        await expect(agent.previewGuardrails).toContainText(marker);
        await expect(agent.preview).not.toContainText(marker);

        // Act: Copy prompt on the ticket
        await recordCopies(page);
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);
        await ticket.goto(ticketKey);
        await delegate.openMenu();
        await delegate.menuItem('delegate-copy').click();

        // Assert
        await expect(page.getByTestId('toast').filter({ hasText: 'Prompt copied' })).toBeVisible();
        const copied = await page.evaluate(() => window.__tkCopied ?? []);
        expect(copied).toHaveLength(1);
        expect(copied[0].trimEnd().endsWith(marker)).toBe(true);
    });

    test('the change is in the audit log without the text, and Reset to built-in undoes it', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const admin = new AdminAgentPromptsPage(page);

        // Act
        await page.goto('/admin/audit');
        await page.getByTestId('view-admin.audit').waitFor();

        // Assert
        const audit = page.getByTestId('view-admin.audit');
        await expect(audit).toContainText('changed agent prompt');
        await expect(audit).toContainText('Guardrails');
        await expect(audit).not.toContainText('Never print secrets');

        // Act
        await page.goto('/admin/agent-prompts/guardrails');
        await admin.editor.waitFor();
        await admin.resetToBuiltIn.click();
        await admin.confirmOk.click();

        // Assert
        await expect(admin.chip).toContainText('Built-in');
        await expect(admin.resetToBuiltIn).toHaveCount(0);
        await expect(admin.body).not.toHaveValue(/Never print secrets/);
    });
});
