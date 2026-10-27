import { Browser, Page as BrowserPage } from '@playwright/test';
import { DocPagePage } from '../../pages/doc-page.page';
import { LoginPage } from '../../pages/login.page';
import { ShellPage } from '../../pages/shell.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';
import { PASSWORD, seedUser } from '../identity/identity';

interface Doc {
    key: string;
    title: string;
}

interface Ticket {
    key: string;
    title: string;
}

function createDoc(api: Api, projectKey: string, body: Record<string, unknown>) {
    return api.post<Doc>(`/projects/${projectKey}/docs`, body);
}

function createTicket(api: Api, projectKey: string, title: string) {
    return api.post<Ticket>(`/projects/${projectKey}/tickets`, { title, type: 'UserStory' });
}

async function signInAs(browser: Browser, email: string): Promise<BrowserPage> {
    const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto('/login');
    await new LoginPage(page).signIn(email, PASSWORD);
    await new ShellPage(page).expectVisible();
    return page;
}

test.describe('doc links', () => {
    test('chips, doc links, embeds, backlinks and the ticket section follow a published page', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const ticket = await createTicket(api, projectKey, 'Save the payment method');
        const runbook = await createDoc(api, projectKey, { kind: 'Page', title: 'Stripe runbook' });
        const diagram = await createDoc(api, projectKey, {
            kind: 'Diagram',
            diagramFormat: 'Mermaid',
            title: 'Checkout flow',
            content: 'flowchart LR\n  Shop --> Stripe',
        });
        const flow = await createDoc(api, projectKey, {
            kind: 'Page',
            title: 'Payment flow',
            content: `Work in ${ticket.key}; see [the runbook](${runbook.key}).\n\n![Checkout](${diagram.key})\n\n\`${projectKey}-99\` stays code.`,
        });
        const view = new DocPagePage(page);

        // Act
        await view.goto(projectKey, flow.key);

        // Assert: the reader renders references from the GET, no extra requests
        const chip = view.content.getByTestId(`ticket-chip-${ticket.key}`);
        await expect(chip).toBeVisible();
        await expect(chip).toHaveAttribute('title', new RegExp('Save the payment method'));
        await expect(
            view.content.locator('a.tk-docref', { hasText: 'the runbook' }),
        ).toHaveAttribute('title', 'Stripe runbook');
        await expect(
            view.content.locator(`figure.tk-doc-embed[data-doc-key="${diagram.key}"]`),
        ).toBeVisible();
        await expect(page.getByTestId(`doc-ticket-${ticket.key}`)).toContainText(
            'Save the payment method',
        );

        // Act + Assert: backlinks on the linked page, docs on the ticket
        await view.goto(projectKey, runbook.key);
        await expect(page.getByTestId(`doc-backlink-${flow.key}`)).toContainText('Payment flow');
        await page.goto(`/tickets/${ticket.key}`);
        await expect(page.getByTestId(`ticket-doc-${flow.key}`)).toContainText('Payment flow');
        await page.getByTestId(`ticket-doc-${flow.key}`).click();
        await expect(view.title).toHaveText('Payment flow');
    });

    test('[[ in the editor picks a doc and inserts a link', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        await createDoc(api, projectKey, { kind: 'Page', title: 'Deploy checklist' });
        const page2 = await createDoc(api, projectKey, {
            kind: 'Page',
            title: 'Release notes',
            content: '',
        });
        const view = new DocPagePage(page);
        await view.goto(projectKey, page2.key, true);

        // Act
        await view.source.click();
        await page.keyboard.type('See [[Deploy');
        const first = page.locator('.cm-tooltip-autocomplete li').first();
        await expect(first).toContainText('Deploy checklist');
        await expect(first).toContainText(`${projectKey}-D-1`);
        await first.click();

        // Assert
        await expect(view.source).toContainText(`See [Deploy checklist](${projectKey}-D-1)`);
        await expect(view.preview.locator('a', { hasText: 'Deploy checklist' })).toBeVisible();
    });

    test('an outsider sees private references as plain text and a private embed as unavailable', async ({
        browser,
        api,
    }) => {
        // Arrange
        const open = (await api.createProject({ visibility: 'Public' })).key;
        const secret = (await api.createProject()).key;
        const hidden = await createTicket(api, secret, 'Confidential merger');
        const topology = await createDoc(api, secret, {
            kind: 'Diagram',
            diagramFormat: 'Mermaid',
            title: 'Secret topology',
            content: 'flowchart LR\n  Vault --> Bank',
        });
        const notes = await createDoc(api, open, {
            kind: 'Page',
            title: 'Public notes',
            content: `Mentions ${hidden.key}.\n\n![Topology](${topology.key})`,
        });
        const outsider = await seedUser(api, 'outsider');
        const page = await signInAs(browser, outsider.email);
        const view = new DocPagePage(page);

        // Act
        await view.goto(open, notes.key);

        // Assert
        await expect(view.content).toContainText(`Mentions ${hidden.key}.`);
        await expect(view.content.locator('a')).toHaveCount(0);
        await expect(view.content.getByTestId('doc-embed-missing')).toHaveText(
            'Diagram not available',
        );
        await expect(view.content).not.toContainText('Confidential');
        await expect(view.content).not.toContainText('Secret topology');
        await expect(page.getByTestId('doc-tickets')).toBeHidden();
        await page.context().close();
    });

    test('a ticket row opens the doc at the first mention; Write doc starts a related page', async ({
        page,
        api,
    }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const ticket = await createTicket(api, projectKey, 'Retry failed payments');
        const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n');
        const notes = await createDoc(api, projectKey, {
            kind: 'Page',
            title: 'Payment notes',
            content: `# Payment notes\n\n${filler}\n\nRetries are tracked in ${ticket.key}.`,
        });
        const view = new DocPagePage(page);

        // Act: open the doc from the ticket's section
        await page.goto(`/tickets/${ticket.key}`);
        await page.getByTestId(`ticket-doc-${notes.key}`).click();

        // Assert: the reader lands on the mention and flashes it
        await expect(view.title).toHaveText('Payment notes');
        await expect(page).toHaveURL(new RegExp(`#mention-${ticket.key}$`));
        const chip = view.content.getByTestId(`ticket-chip-${ticket.key}`);
        await expect(chip).toBeInViewport();
        await expect(chip).toHaveClass(/tk-flash/);
        await expect(chip).not.toHaveClass(/tk-flash/);

        // Act: Write doc from the ticket
        await page.goto(`/tickets/${ticket.key}`);
        await page.getByTestId('ticket-docs-write').click();

        // Assert: the editor opens on a new top-level page that names the ticket
        await expect(view.source).toContainText(`Related: ${ticket.key}`);
        await expect(page).toHaveURL(/\?mode=edit$/);
        const created = await api.get<{ items: { title: string; parentKey: string | null }[] }>(
            `/projects/${projectKey}/docs/tree`,
        );
        expect(created.items.map((i) => [i.title, i.parentKey])).toContainEqual([
            `${ticket.key} Retry failed payments`,
            null,
        ]);
    });

    test('an older version renders its own ticket chips and embeds', async ({ page, api }) => {
        // Arrange
        const projectKey = (await api.createProject()).key;
        const ticket = await createTicket(api, projectKey, 'First approach');
        const diagram = await createDoc(api, projectKey, {
            kind: 'Diagram',
            diagramFormat: 'Mermaid',
            title: 'Old flow',
            content: 'flowchart LR\n  A --> B',
        });
        const doc = await createDoc(api, projectKey, {
            kind: 'Page',
            title: 'Design',
            content: `Tracked in ${ticket.key}.\n\n![Old flow](${diagram.key})`,
        });
        await api.patch(`/docs/${doc.key}`, { content: 'Rewritten.', baseVersion: 1 });

        // Act
        await page.goto(`/projects/${projectKey}/docs/${doc.key}/design?v=1`);

        // Assert
        const content = page.getByTestId('doc-version-content');
        await expect(content.getByTestId(`ticket-chip-${ticket.key}`)).toBeVisible();
        await expect(
            content.locator(`figure.tk-doc-embed[data-doc-key="${diagram.key}"]`),
        ).toBeVisible();
        await expect(content).not.toContainText('Diagram not available');
    });
});
