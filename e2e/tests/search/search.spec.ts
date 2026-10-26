import { readFile } from 'node:fs/promises';
import { SearchPage } from '../../pages/search.page';
import { TicketPage } from '../../pages/ticket.page';
import { Api } from '../../support/api';
import { expect, test } from '../../support/fixtures';

interface TicketSummary {
  id: string;
  key: string;
  title: string;
}

interface CurrentUser {
  id: string;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function createTicket(api: Api, projectKey: string, title: string, extra: object = {}): Promise<TicketSummary> {
  return api.post<TicketSummary>(`/projects/${projectKey}/tickets`, { title, type: 'UserStory', ...extra });
}

test.describe('search, quick jump, attachments and My work', () => {
  test('search by text and filters, reload the shared URL, export CSV', async ({ page, api }) => {
    // Arrange
    const projectKey = (await api.createProject()).key;
    const word = `zebra${Date.now().toString(36)}`;
    const bug = await createTicket(api, projectKey, `Checkout crashes on ${word} cards`, { type: 'Bug', priority: 'High' });
    const story = await createTicket(api, projectKey, `Redesign ${word} checkout`);
    await createTicket(api, projectKey, 'Unrelated ticket');
    const search = new SearchPage(page);
    await search.goto();

    // Act: text, then a type filter chip
    await search.search(word);
    await expect(search.row(bug.key)).toBeVisible();
    await expect(search.row(story.key)).toBeVisible();
    await search.toggle('type', 'Bug');

    // Assert: the filter state is in the URL and survives a reload of that URL
    await expect(search.row(story.key)).toBeHidden();
    await expect(search.rows()).toHaveCount(1);
    await expect(page).toHaveURL(/type=Bug/);
    expect(new URL(page.url()).searchParams.get('type')).toBe('Bug');
    const shared = page.url();
    await page.goto('about:blank');
    await page.goto(shared);
    await expect(search.row(bug.key)).toBeVisible();
    await expect(search.rows()).toHaveCount(1);
    await expect(search.text).toHaveValue(word);
    await expect(page.getByTestId('filter-type')).toContainText('Bug');

    // Act: export
    const downloadPromise = page.waitForEvent('download');
    await search.exportButton.click();
    const download = await downloadPromise;

    // Assert
    expect(download.suggestedFilename()).toMatch(/^tickets-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path())!, 'utf8');
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('Key,Project,Project name,Title');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(bug.key);
  });

  test('Ctrl+K: typing a ticket key opens the ticket', async ({ page, api, shell }) => {
    // Arrange
    const projectKey = (await api.createProject()).key;
    const ticket = await createTicket(api, projectKey, 'Jump straight here');
    await page.goto('/my-work');
    await shell.expectVisible();

    // Act
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeFocused();
    await input.fill(ticket.key.toLowerCase());
    await expect(page.getByTestId(`palette-item-jump:${ticket.key}`)).toBeVisible();
    await input.press('Enter');

    // Assert
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.key}$`));
    await expect(new TicketPage(page).title).toHaveText('Jump straight here');
  });

  test('Ctrl+K: typing title words lists matching tickets', async ({ page, api, shell }) => {
    // Arrange
    const projectKey = (await api.createProject()).key;
    const word = `quokka${Date.now().toString(36)}`;
    const ticket = await createTicket(api, projectKey, `Feed the ${word}`);
    await page.goto('/my-work');
    await shell.expectVisible();

    // Act
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByTestId('command-palette-input').fill(word);
    const item = page.getByTestId(`palette-item-Ticket:${ticket.key}`);
    await expect(item).toBeVisible();
    await item.click();

    // Assert
    await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.key}$`));
  });

  test('upload an image attachment and see it in the ticket', async ({ page, api }) => {
    // Arrange
    const projectKey = (await api.createProject()).key;
    const ticket = await createTicket(api, projectKey, 'Has a screenshot');
    const view = new TicketPage(page);
    await view.goto(ticket.key);
    const section = view.root.getByTestId('ticket-attachments');
    await expect(section).toBeVisible();

    // Act
    await section.getByTestId('attachments-input').setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG });

    // Assert
    const row = section.getByTestId('attachment-row-screen.png');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('attachment-thumb')).toHaveJSProperty('naturalWidth', 1);
    await expect(section.getByTestId('attachments-count')).toHaveText('1');
    await page.reload();
    await expect(view.root.getByTestId('attachment-row-screen.png')).toBeVisible();
  });

  test('My work lists open tickets assigned to me grouped by project', async ({ page, api }) => {
    // Arrange
    const me = await api.get<CurrentUser>('/me');
    const projectKey = (await api.createProject()).key;
    const mine = await createTicket(api, projectKey, 'Assigned to me', { assignee: me.id });
    const done = await createTicket(api, projectKey, 'Already done', { assignee: me.id, status: 'Done' });
    const unassigned = await createTicket(api, projectKey, 'Nobody owns this');

    // Act
    await page.goto('/my-work');

    // Assert
    const group = page.getByTestId(`my-work-group-${projectKey}`);
    await expect(group).toBeVisible();
    await expect(page.getByTestId(`my-work-row-${mine.key}`)).toBeVisible();
    await expect(page.getByTestId(`my-work-row-${done.key}`)).toHaveCount(0);
    await expect(page.getByTestId(`my-work-row-${unassigned.key}`)).toHaveCount(0);
    await page.getByTestId(`my-work-row-${mine.key}`).click();
    await expect(page).toHaveURL(new RegExp(`peek=${mine.key}`));
  });
});
