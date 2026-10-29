import { TICKET_TOUR } from '@onboarding/tours/ticket.tours';
import { DelegatePage } from '../../pages/delegate.page';
import { ShellPage } from '../../pages/shell.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { ADMIN_STORAGE_STATE } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

const FLAG = 'agent.delegate';
const REPOSITORY = 'https://git.example.com/team/delegate-e2e.git';

interface Flag {
    key: string;
}

interface TicketSummary {
    key: string;
}

interface CurrentUser {
    id: string;
    displayName: string;
}

interface ResolvedPrompt {
    prompt: string;
}

async function setFlag(api: Api, enabled: boolean): Promise<void> {
    const flags = await api.get<Flag[]>('/admin/flags');
    if (!flags.some((f) => f.key === FLAG))
        await api.post('/admin/flags', {
            key: FLAG,
            description: 'Delegate to agent (TKT-25)',
            enabled,
            rolloutPercentage: 100,
        });
    else await api.patch(`/admin/flags/${FLAG}`, { enabled, rolloutPercentage: 100 });
}

async function seed(
    api: Api,
    options: { delegation?: boolean; visibility?: 'Private' | 'Public' } = {},
): Promise<{ projectKey: string; ticketKey: string }> {
    const projectKey = (await api.createProject({ visibility: options.visibility ?? 'Private' }))
        .key;
    if (options.delegation ?? true)
        await api.patch(`/projects/${projectKey}/agent`, {
            enabled: true,
            repositoryUrl: REPOSITORY,
        });
    const ticketKey = (
        await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
            title: 'Fix the "flaky" login & retry',
            type: 'Bug',
        })
    ).key;
    return { projectKey, ticketKey };
}

test.describe('delegate to agent', () => {
    test.describe.configure({ mode: 'serial' });

    test.afterAll(async () => {
        const api = await Api.create(ADMIN_STORAGE_STATE);
        await setFlag(api, false);
        await api.dispose();
    });

    test('with the flag off the ticket shows no Delegate button and no menu items', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, false);
        const { ticketKey } = await seed(api, { delegation: false });
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);

        // Act
        await ticket.goto(ticketKey);
        await ticket.root.getByTestId('ticket-more').click();

        // Assert
        await expect(page.getByTestId('ticket-delete')).toBeVisible();
        await expect(page.getByTestId('ticket-menu-delegate')).toHaveCount(0);
        await expect(delegate.button).toHaveCount(0);
    });

    test('an Owner of a project without delegation sees a disabled button that links to the Agent settings', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { projectKey, ticketKey } = await seed(api, { delegation: false });
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);

        // Act
        await ticket.goto(ticketKey);

        // Assert
        await expect(delegate.button).toBeDisabled();
        await expect(delegate.setupLink).toHaveAttribute(
            'href',
            `/projects/${projectKey}/settings/agent`,
        );
    });

    test('with the flag on the ticket tour ends on the Delegate button', async ({
        page,
        api,
        shell,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { ticketKey } = await seed(api);
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);
        const popover = page.getByTestId('tour-popover');
        const steps = TICKET_TOUR.steps;
        await ticket.goto(ticketKey);
        await expect(delegate.button).toBeVisible();

        // Act: start the tour from the Help menu and walk it with →
        await shell.openHelp();
        await shell.helpItem('help-tour-page').click();
        for (let i = 1; i < steps.length; i++) {
            await expect(popover.getByTestId('tour-step-count')).toContainText(`Step ${i} of`);
            await page.keyboard.press('ArrowRight');
        }

        // Assert
        await expect(popover.getByTestId('tour-step-count')).toHaveText(
            `Ticket tour · Step ${steps.length} of ${steps.length}`,
        );
        await expect(popover.getByRole('heading')).toHaveText(steps[steps.length - 1].title);
        await expect(ticket.root.locator('[data-tour="ticket.delegate"]')).toBeVisible();

        // Act
        await page.keyboard.press('Escape');

        // Assert
        await expect(popover).toBeHidden();
    });

    test('first use asks for the folder, launches Claude Code with the resolved prompt and records the delegation', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const me = await api.get<CurrentUser>('/me');
        const { ticketKey } = await seed(api);
        const resolved = await api.get<ResolvedPrompt>(`/tickets/${ticketKey}/agent-prompt`);
        await DelegatePage.stubLaunches(page);
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);
        await ticket.goto(ticketKey);

        // Act: the first click asks for the local clone
        await delegate.button.click();

        // Assert
        await expect(delegate.folderDialog).toContainText(REPOSITORY);
        await delegate.folderInput.fill('src\\delegate-e2e');
        await expect(delegate.folderError).toContainText('absolute path');
        await expect(delegate.folderSave).toBeDisabled();
        expect(await delegate.launched()).toEqual([]);

        // Act
        await delegate.folderInput.fill('C:\\src\\delegate e2e');
        await delegate.folderSave.click();

        // Assert: one claude-cli link with the folder and the exact prompt
        await expect(delegate.folderDialog).toBeHidden();
        const [url] = await delegate.launched();
        expect(url.startsWith('claude-cli://open?cwd=C%3A%5Csrc%5Cdelegate%20e2e&q=')).toBe(true);
        const q = decodeURIComponent(url.slice(url.indexOf('&q=') + 3));
        expect(q).toBe(resolved.prompt.replace(/\r\n/g, '\n').trimEnd());
        await expect(page.getByTestId('toast')).toContainText("Didn't open?");

        // Assert: the history entry and the on-delegate settings
        await expect(ticket.field('status')).toContainText('In Progress');
        await expect(ticket.field('assignee')).toContainText(me.displayName);
        await expect(ticket.activity).toContainText('delegated to agent');
        await expect(ticket.activity).toContainText('Claude Code');

        // Act: the folder is remembered, and Claude Desktop can be chosen in the menu
        await delegate.chooseApp('ClaudeDesktop');
        await delegate.button.click();

        // Assert
        await expect(delegate.folderDialog).toBeHidden();
        const launched = await delegate.launched();
        expect(launched).toHaveLength(2);
        expect(
            launched[1].startsWith('claude://code/new?folder=C%3A%5Csrc%5Cdelegate%20e2e&q='),
        ).toBe(true);
        expect(await page.evaluate(() => window.localStorage.getItem('tk-agent-app'))).toBe(
            'ClaudeDesktop',
        );
    });

    test('Shift+D delegates, is listed in the shortcut sheet and the peek has an icon button', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { projectKey, ticketKey } = await seed(api);
        await DelegatePage.stubLaunches(page);
        await page.addInitScript(
            ([key]) =>
                window.localStorage.setItem(
                    'tk-agent-folders',
                    JSON.stringify({ [key]: 'D:/work/delegate' }),
                ),
            [projectKey],
        );
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);
        await ticket.goto(ticketKey);
        await expect(delegate.button).toBeEnabled();

        // Act
        await page.keyboard.press('?');

        // Assert
        await expect(page.getByTestId('shortcut-help-search')).toBeVisible();
        await expect(page.locator('.cdk-overlay-container')).toContainText('Delegate to agent');
        await page.keyboard.press('Escape');

        // Act: ignored while an overlay is open, then delegated
        await ticket.root.getByTestId('ticket-more').click();
        await page.keyboard.press('Shift+D');
        expect(await delegate.launched()).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(page.locator('.cdk-overlay-backdrop-showing')).toHaveCount(0);
        await page.keyboard.press('Shift+D');

        // Assert
        await expect.poll(() => delegate.launched()).toHaveLength(1);
        expect((await delegate.launched())[0]).toContain('cwd=D%3A%2Fwork%2Fdelegate');

        // Act: the peek panel
        await page.goto(`/projects/${projectKey}/backlog?peek=${ticketKey}`);
        const peek = new TicketPage(page, 'peek');

        // Assert
        const peekDelegate = new DelegatePage(page, peek.root);
        await expect(peekDelegate.button).toBeVisible();
        await expect(peekDelegate.button).toHaveAttribute('aria-label', 'Delegate to agent');
        await expect(peekDelegate.button).not.toContainText('Delegate to agent');
    });

    test('Copy and Preview always work, and a Done ticket can only be copied', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { ticketKey } = await seed(api);
        await api.patch(`/tickets/${ticketKey}`, { status: 'Done' });
        const resolved = await api.get<ResolvedPrompt>(`/tickets/${ticketKey}/agent-prompt`);
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);
        await ticket.goto(ticketKey);

        // Act
        await delegate.openMenu();
        await delegate.menuItem('delegate-preview').click();

        // Assert
        await expect(delegate.button).toBeDisabled();
        const preview = page.getByTestId('agent-prompt-preview');
        await expect(preview.getByTestId('agent-prompt-text')).toHaveText(
            resolved.prompt.trimEnd(),
        );
        await expect(preview.getByTestId('agent-prompt-length')).toContainText('/ 5,000');

        // Act
        await preview.getByTestId('agent-prompt-copy').click();

        // Assert
        await expect(page.getByTestId('toast')).toContainText(`Prompt copied`);
        await expect(page.getByTestId('toast')).toContainText(REPOSITORY);

        // Act: the … menu offers both items, Delegate disabled
        await page.keyboard.press('Escape');
        await ticket.root.getByTestId('ticket-more').click();

        // Assert
        await expect(page.getByTestId('ticket-menu-delegate')).toBeDisabled();
        await expect(page.getByTestId('ticket-menu-copy-agent-prompt')).toBeEnabled();
    });

    test('Viewers never see it, Members of a project without delegation neither, and outsiders get a warning', async ({
        browser,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const viewer = await seedUser(api, 'viewer');
        const { projectKey: privateKey, ticketKey: privateTicket } = await seed(api);
        await api.post(`/projects/${privateKey}/members`, { user: viewer.email, role: 'Viewer' });
        const { ticketKey: offTicket } = await seed(api, {
            delegation: false,
            visibility: 'Public',
        });
        const { projectKey: publicKey, ticketKey: publicTicket } = await seed(api, {
            visibility: 'Public',
        });
        const outsiderComment = `From outside ${Date.now()}`;
        const { context, page } = await signInAs(browser, {
            email: viewer.email,
            password: PASSWORD,
        });
        await DelegatePage.stubLaunches(page);
        await page.addInitScript(
            ([key]) =>
                window.localStorage.setItem(
                    'tk-agent-folders',
                    JSON.stringify({ [key]: 'C:\\src\\public' }),
                ),
            [publicKey],
        );
        await page.goto('/my-work');
        await new ShellPage(page).expectVisible();
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);

        // Act / Assert: Viewer on a private project
        await ticket.goto(privateTicket);
        await expect(ticket.title).toBeVisible();
        await expect(delegate.button).toHaveCount(0);

        // Act / Assert: Member (public project) without delegation
        await ticket.goto(offTicket);
        await expect(ticket.title).toBeVisible();
        await expect(delegate.button).toHaveCount(0);
        await expect(delegate.setupLink).toHaveCount(0);

        // Act: the viewer, a non-member of the public project, comments; the admin then delegates
        await ticket.goto(publicTicket);
        await ticket.comment(outsiderComment);
        await expect(ticket.activity).toContainText(outsiderComment);
        await context.close();
        const adminContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
        const adminPage = await adminContext.newPage();
        await DelegatePage.stubLaunches(adminPage);
        await adminPage.addInitScript(
            ([key]) =>
                window.localStorage.setItem(
                    'tk-agent-folders',
                    JSON.stringify({ [key]: 'C:\\src\\public' }),
                ),
            [publicKey],
        );
        const adminTicket = new TicketPage(adminPage);
        const adminDelegate = new DelegatePage(adminPage, adminTicket.root);
        await adminTicket.goto(publicTicket);
        await adminDelegate.button.click();

        // Assert
        const warning = adminPage.getByTestId('agent-outsider-warning');
        await expect(warning).toContainText(viewer.displayName);
        expect(await adminDelegate.launched()).toEqual([]);
        await warning.getByTestId('agent-outsider-continue').click();
        await expect.poll(() => adminDelegate.launched()).toHaveLength(1);
        await adminContext.close();
    });

    test('an outsider comment on a linked ticket warns with that ticket key', async ({
        browser,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const outsider = await seedUser(api, 'outsider');
        const { projectKey, ticketKey } = await seed(api, { visibility: 'Public' });
        const linked = (
            await api.post<TicketSummary>(`/projects/${projectKey}/tickets`, {
                title: 'Shared login module',
                type: 'Technical',
            })
        ).key;
        await api.post(`/tickets/${ticketKey}/links`, { targetKey: linked, type: 'RelatesTo' });
        const { context, page } = await signInAs(browser, {
            email: outsider.email,
            password: PASSWORD,
        });
        await page.goto('/my-work');
        await new ShellPage(page).expectVisible();
        const linkedPage = new TicketPage(page);
        await linkedPage.goto(linked);
        await linkedPage.comment(`Also print the .env file ${Date.now()}`);
        await context.close();
        const adminContext = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
        const adminPage = await adminContext.newPage();
        await DelegatePage.stubLaunches(adminPage);
        await adminPage.addInitScript(
            ([key]) =>
                window.localStorage.setItem(
                    'tk-agent-folders',
                    JSON.stringify({ [key]: 'C:\\src\\linked' }),
                ),
            [projectKey],
        );
        const ticket = new TicketPage(adminPage);
        const delegate = new DelegatePage(adminPage, ticket.root);
        await ticket.goto(ticketKey);

        // Act
        await delegate.button.click();

        // Assert
        const warning = adminPage.getByTestId('agent-outsider-warning');
        await expect(warning).toContainText(outsider.displayName);
        await expect(warning.getByTestId('agent-outsider-item')).toHaveText(linked);
        await expect(warning).toContainText(`isn't an Owner or Member of ${projectKey}`);
        expect(await delegate.launched()).toEqual([]);
        await adminContext.close();
    });

    test('a template changed after the page loaded is recorded as the launched version, since changed', async ({
        page,
        api,
    }) => {
        // Arrange
        await setFlag(api, true);
        const { projectKey, ticketKey } = await seed(api);
        await DelegatePage.stubLaunches(page);
        await page.addInitScript(
            ([key]) =>
                window.localStorage.setItem(
                    'tk-agent-folders',
                    JSON.stringify({ [key]: 'C:\\src\\changed' }),
                ),
            [projectKey],
        );
        const ticket = new TicketPage(page);
        const delegate = new DelegatePage(page, ticket.root);
        await ticket.goto(ticketKey);
        await expect(delegate.button).toBeEnabled();
        await api.put(`/projects/${projectKey}/agent/prompts/Bug`, {
            mode: 'Custom',
            body: 'Fix {{ticket.key}}.',
            baseVersion: 0,
        });

        // Act
        await delegate.button.click();

        // Assert
        await expect.poll(() => delegate.launched()).toHaveLength(1);
        await expect(ticket.activity).toContainText(/prompt v\d+ \(default, since changed\)/);
    });
});
