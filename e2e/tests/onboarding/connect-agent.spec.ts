import { CONNECT_AGENT_HELP_ID } from '@onboarding/agent/connect-agent';
import { ShellPage } from '../../pages/shell.page';
import { expect, test } from '../../support/fixtures';
import { xsrfToken } from '../../support/guides';
import { McpSession } from '../../support/mcp';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

const HELP_ITEM = CONNECT_AGENT_HELP_ID.replaceAll('.', '-');

interface Onboarding {
    checklist: { id: string; done: boolean }[];
}

test.describe('Connect an AI agent', () => {
    test('Help opens the guide; a token, the copied command and a real MCP call turn the check green', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'agent');
        const { context, page } = await signInAs(
            browser,
            { email: user.email, password: PASSWORD },
            { contextOptions: { permissions: ['clipboard-read', 'clipboard-write'] } },
        );
        const shell = new ShellPage(page);
        await page.goto('/projects');
        const guide = page.getByTestId('connect-agent-guide');

        // Act
        await shell.openHelp();
        await shell.helpItem(HELP_ITEM).click();

        // Assert
        await expect(page).toHaveURL(/\/profile\/tokens\?guide=connect-agent$/);
        await expect(guide).toBeVisible();
        await expect(page.locator('#connect-agent-title')).toBeFocused();
        await expect(page.getByTestId('connect-agent-step-token')).toHaveAttribute(
            'data-state',
            'current',
        );

        // Act
        await page.getByTestId('connect-agent-create').click();
        await expect(page.getByTestId('token-name')).toHaveValue('Claude Code');
        await page.getByTestId('token-create').click();

        // Assert
        await expect(page.getByTestId('token-secret')).toBeHidden();
        await expect(page.getByTestId('connect-agent-step-token')).toHaveAttribute(
            'data-state',
            'done',
        );
        await expect(page.getByTestId('connect-agent-command')).not.toContainText('tkt_...');
        const command = (await page.getByTestId('connect-agent-command').textContent())!.trim();
        const secret = /Bearer (tkt_[0-9A-Za-z]{40})"/.exec(command)?.[1];
        expect(secret).toBeTruthy();
        expect(command).toBe(
            `claude mcp add --transport http ticketing ${new URL(page.url()).origin}/mcp --header "Authorization: Bearer ${secret}"`,
        );

        // Act
        await page.getByTestId('connect-agent-copy').click();

        // Assert
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
        await expect(page.getByTestId('connect-agent-step-command')).toHaveAttribute(
            'data-state',
            'done',
        );
        await expect(page.getByTestId('connect-agent-status')).toHaveAttribute(
            'data-connected',
            'false',
        );

        // Act
        const mcp = await McpSession.connect(secret!);
        const initialized = await mcp.initialize();
        const me = await mcp.callTool<{ email: string; tokenScope: string }>('whoami');
        await mcp.dispose();

        // Assert
        expect(initialized.serverInfo.name).toBe('ticketing');
        expect(initialized.instructions).toContain('Call `whoami` first');
        expect(me.email).toBe(user.email);
        expect(me.tokenScope).toBe('ReadWrite');
        await expect(page.getByTestId('connect-agent-status')).toHaveAttribute(
            'data-connected',
            'true',
            {
                timeout: 15_000,
            },
        );
        await expect(page.getByTestId('connect-agent-step-check')).toHaveAttribute(
            'data-state',
            'done',
        );
        await expect(page.getByTestId('connect-agent-status')).toContainText('Connected');
        const onboarding = (await (
            await context.request.get('/api/v1/me/onboarding')
        ).json()) as Onboarding;
        const agentItems = onboarding.checklist.filter((i) => i.id.startsWith('agent-'));
        expect(agentItems).toEqual([
            expect.objectContaining({ id: 'agent-token', done: true }),
            expect.objectContaining({ id: 'agent-connected', done: true }),
        ]);
        await context.close();
    });

    test('the empty tokens page links to the guide, and closing it returns focus to the page', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'agent-empty');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        await page.goto('/profile/tokens');
        await expect(page.getByText('No access tokens yet')).toBeVisible();

        // Act
        await page.getByTestId('tokens-connect-agent').click();

        // Assert
        await expect(page.getByTestId('connect-agent-guide')).toBeVisible();
        await expect(page.getByText('No access tokens yet')).toBeHidden();
        await expect(page.getByTestId('connect-agent-status')).toContainText(
            'Turns green once the agent has used the token',
        );

        // Act
        await page.getByTestId('connect-agent-close').focus();
        await page.keyboard.press('Enter');

        // Assert
        await expect(page.getByTestId('connect-agent-guide')).toBeHidden();
        await expect(page).toHaveURL(/\/profile\/tokens$/);
        await expect(page.getByTestId('tokens-new')).toBeFocused();
        await expect(page.getByText('No access tokens yet')).toBeVisible();
        await context.close();
    });

    test('a user who connected before sees the check green at once, with the token to replace', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'agent-before');
        const { context, page } = await signInAs(browser, {
            email: user.email,
            password: PASSWORD,
        });
        const created = await context.request.post('/api/v1/me/tokens', {
            data: { name: 'Laptop', scope: 'ReadOnly' },
            headers: { 'X-XSRF-TOKEN': await xsrfToken(context.request) },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const mcp = await McpSession.connect(((await created.json()) as { secret: string }).secret);
        await mcp.callTool('whoami');
        await mcp.dispose();

        // Act
        await page.goto('/profile/tokens?guide=connect-agent');

        // Assert
        await expect(page.getByTestId('connect-agent-status')).toHaveAttribute(
            'data-connected',
            'true',
        );
        await expect(page.getByTestId('connect-agent-command')).toContainText('Bearer tkt_..."');
        await expect(page.getByTestId('connect-agent-step-token')).toContainText('Laptop');
        await context.close();
    });
});
