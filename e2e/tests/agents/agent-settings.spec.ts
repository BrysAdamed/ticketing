import { AgentSettingsPage } from '../../pages/agent-settings.page';
import { LoginPage } from '../../pages/login.page';
import { Api } from '../../support/api';
import { ADMIN_STORAGE_STATE } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { PASSWORD, seedUser } from '../identity/identity';

const FLAG = 'agent.delegate';

interface Flag {
    key: string;
}

interface TicketSummary {
    key: string;
}

async function setFlag(api: Api, enabled: boolean, targetRoles = ['Admin']): Promise<void> {
    const flags = await api.get<Flag[]>('/admin/flags');
    if (!flags.some((f) => f.key === FLAG))
        await api.post('/admin/flags', {
            key: FLAG,
            description: 'Delegate to agent (TKT-25)',
            enabled,
            targetRoles,
        });
    else await api.patch(`/admin/flags/${FLAG}`, { enabled, targetRoles });
}

async function seedProject(api: Api): Promise<{ projectKey: string; bug: string }> {
    const projectKey = (await api.createProject()).key;
    const bug = (
        await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Login fails on Safari',
            type: 'Bug',
        })
    ).key;
    return { projectKey, bug };
}

test.describe('agent settings tab', () => {
    test.describe.configure({ mode: 'serial' });

    test.afterAll(async () => {
        const api = await Api.create(ADMIN_STORAGE_STATE);
        await setFlag(api, false);
        await api.dispose();
    });

    test('with the flag off there is no Agent tab and no agent page', async ({ page, api }) => {
        // Arrange
        await setFlag(api, false);
        const { projectKey } = await seedProject(api);
        const agent = new AgentSettingsPage(page);

        // Act
        await page.goto(`/projects/${projectKey}/settings`);

        // Assert
        await expect(page.getByTestId('project-settings-tab-index')).toBeVisible();
        await expect(agent.tab).toHaveCount(0);
        await page.goto(`/projects/${projectKey}/settings/agent`);
        await expect(page.getByTestId('view-app.not-found')).toBeVisible();
        await expect(agent.view).toHaveCount(0);
    });

    test('a member sees the Agent tab and the prompts read-only', async ({ browser, api }) => {
        // Arrange
        await setFlag(api, true, ['Admin', 'User']);
        const { projectKey } = await seedProject(api);
        const member = await seedUser(api, 'agent-member');
        await api.post(`/projects/${projectKey}/members`, { user: member.id, role: 'Member' });
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        const page = await context.newPage();
        const login = new LoginPage(page);
        await login.goto(`/projects/${projectKey}/settings`);
        await login.signIn(member.email, PASSWORD);
        const agent = new AgentSettingsPage(page);

        // Act
        await agent.tab.click();
        await agent.view.waitFor();

        // Assert
        await expect(page.getByTestId('agent-setup-readonly')).toBeVisible();
        await expect(agent.enabled).toBeDisabled();
        await expect(agent.repositoryUrl).toBeDisabled();
        await expect(agent.saveSetup).toHaveCount(0);

        // Act
        await agent.promptRow('Bug').click();
        await agent.editor.waitFor();

        // Assert
        await expect(page.getByTestId('agent-prompt-readonly')).toBeVisible();
        await expect(agent.save).toHaveCount(0);
        await expect(agent.mode('Custom')).toHaveCount(0);
        await expect(agent.preview).toBeVisible();
        await context.close();
    });

    test('an owner enables delegation, customises the Bug prompt, previews, saves, resets and restores', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { projectKey, bug } = await seedProject(api);
        const agent = new AgentSettingsPage(page);
        await page.goto(`/projects/${projectKey}/settings`);

        // Act: enabling without a repository shows the server error inline
        await agent.tab.click();
        await agent.view.waitFor();
        await agent.enabled.click();
        await agent.saveSetup.click();

        // Assert
        await expect(agent.repositoryUrlError).toBeVisible();

        // Act: a valid remote, the merge policy warning, save
        await agent.repositoryUrl.fill('not a remote');
        await expect(agent.repositoryUrlError).toContainText('git remote');
        await agent.repositoryUrl.fill('git@Git.Example.com:team/repo.git');
        await expect(agent.repositoryUrlNormalized).toHaveText(
            'Matches clones of git.example.com/team/repo',
        );
        await agent.mergeWhenVerified.check();
        await expect(agent.mergeWarning).toBeVisible();
        await agent.mergeReview.check();
        await expect(agent.mergeWarning).toHaveCount(0);
        await agent.saveSetup.click();

        // Assert
        await expect(page.getByTestId('toast')).toContainText('Delegation settings saved.');
        const settings = await api.get<{ enabled: boolean; repositoryUrl: string }>(
            `/projects/${projectKey}/agent`,
        );
        expect(settings).toEqual(
            expect.objectContaining({
                enabled: true,
                repositoryUrl: 'git@Git.Example.com:team/repo.git',
            }),
        );
        await expect(agent.promptChip('Bug')).toHaveText(/Default v\d+/);

        // Act: customise the Bug prompt with a placeholder from the completion list
        await agent.promptRow('Bug').click();
        await agent.editor.waitFor();
        await agent.mode('Custom').click();
        await agent.body.fill('Fix ');
        await agent.body.press('End');
        await agent.body.pressSequentially('{{tic');
        await expect(agent.completion).toBeVisible();
        await agent.completionOption('ticket.key').click();
        await agent.body.pressSequentially(' on Safari.');

        // Assert: the server preview renders the latest Bug of the project, guardrails greyed
        await expect(agent.body).toHaveValue('Fix {{ticket.key}} on Safari.');
        await expect(agent.preview).toHaveText(`Fix ${bug} on Safari.`);
        await expect(agent.previewGuardrails).toContainText('<delegation_rules>');

        // Act: an unknown placeholder is underlined at its position
        await agent.body.fill('Fix {{ticket.key}} on Safari.\n{{ticket.title}}');

        // Assert
        await expect(agent.issueMark).toHaveText('{{ticket.title}}');
        await expect(page.getByTestId('agent-prompt-body-issues')).toContainText('Line 2');

        // Act: fix it and save with Ctrl+S
        await agent.body.fill('Fix {{ticket.key}} on Safari.');
        await expect(agent.issueMark).toHaveCount(0);
        await agent.changeNote.fill('Safari first');
        await agent.body.press('Control+s');

        // Assert
        await expect(agent.chip).toHaveText('Custom v1');

        // Act: compare with the default
        await agent.panel('compare').click();

        // Assert
        await expect(agent.diff).toBeVisible();
        await expect(page.getByTestId('prompt-diff-left-label')).toHaveText(/Default v\d+/);

        // Act: a second version, then reset to default
        await agent.body.fill('Fix {{ticket.key}} with a failing test first.');
        await agent.save.click();
        await expect(agent.chip).toHaveText('Custom v2');
        await agent.reset.click();
        await agent.confirmOk.click();

        // Assert
        await expect(agent.chip).toHaveText(/Default v\d+/);
        await expect(page.getByTestId('agent-prompt-inherits')).toBeVisible();

        // Act: restore version 2 from the history
        await agent.panel('history').click();
        await expect(agent.historyRow(3)).toBeVisible();
        await agent.restore(2).click();
        await agent.confirmOk.click();

        // Assert
        await expect(agent.chip).toHaveText('Custom v4');
        await expect(agent.body).toHaveValue('Fix {{ticket.key}} with a failing test first.');
        await expect(agent.historyRow(4)).toContainText('restored from v2');

        // Act: unsaved changes ask before leaving
        await agent.body.fill('Unsaved');
        await agent.back.click();
        await agent.confirmCancel.click();

        // Assert
        await expect(agent.confirmOk).toHaveCount(0);
        await expect(agent.editor).toBeVisible();
        await agent.back.click();
        await agent.confirmOk.click();
        await expect(agent.promptChip('Bug')).toHaveText('Custom v4');
    });
});
