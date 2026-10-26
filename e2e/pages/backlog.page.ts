import { expect, Locator, Page } from '@playwright/test';

/// The project backlog (`/projects/:key/backlog`): rows, quick create, inline pickers, drag and drop.
export class BacklogPage {
  readonly view: Locator;
  readonly list: Locator;
  readonly count: Locator;
  readonly quickCreateInput: Locator;
  readonly showDone: Locator;

  constructor(private readonly page: Page) {
    this.view = page.getByTestId('view-backlog.list');
    this.list = page.getByTestId('backlog-list');
    this.count = page.getByTestId('backlog-count');
    this.quickCreateInput = page.getByTestId('quick-create-input');
    this.showDone = page.getByTestId('show-done');
  }

  async goto(projectKey: string): Promise<void> {
    await this.page.goto(`/projects/${projectKey}/backlog`);
    await expect(this.view).toBeVisible();
  }

  row(key: string): Locator {
    return this.page.getByTestId(`backlog-row-${key}`);
  }

  /// Ticket keys in display order.
  async keys(): Promise<string[]> {
    const ids = await this.list.locator('tk-backlog-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid') ?? ''));
    return ids.map((id) => id.replace('backlog-row-', ''));
  }

  async quickCreate(title: string): Promise<void> {
    await this.page.keyboard.press('c');
    await expect(this.quickCreateInput).toBeFocused();
    await this.quickCreateInput.fill(title);
    await this.quickCreateInput.press('Enter');
  }

  /// Picks an option in a row's inline picker (status, priority, assignee, points) by its label.
  async pick(key: string, field: 'status' | 'priority' | 'assignee' | 'points', option: string): Promise<void> {
    await this.row(key).getByTestId(`row-${field}`).click();
    const picker = this.page.getByTestId('inline-picker');
    await picker.getByRole('option', { name: new RegExp(`^${option}(\\s|$)`) }).click();
    await expect(picker).toBeHidden();
  }

  /// Drags a row and drops it on the upper half of `targetKey`'s row (so it lands right before it).
  async dragBefore(key: string, targetKey: string): Promise<void> {
    const source = await this.row(key).boundingBox();
    const target = await this.row(targetKey).boundingBox();
    if (!source || !target) throw new Error('Rows are not visible.');
    await this.page.mouse.move(source.x + 300, source.y + source.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(source.x + 300, source.y + source.height / 2 - 8, { steps: 4 });
    await this.page.mouse.move(target.x + 300, target.y + 3, { steps: 12 });
    await expect(this.page.getByTestId('drop-indicator')).toBeVisible();
    await this.page.mouse.up();
  }
}
