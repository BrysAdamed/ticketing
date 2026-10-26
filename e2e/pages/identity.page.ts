import { expect, Locator, Page } from '@playwright/test';

/// /admin/users: the users table, the create dialog and the one-time link dialog.
export class AdminUsersPage {
  readonly newUser: Locator;
  readonly search: Locator;
  readonly linkInput: Locator;

  constructor(private readonly page: Page) {
    this.newUser = page.getByTestId('users-new');
    this.search = page.getByTestId('users-search');
    this.linkInput = page.getByTestId('set-password-link');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/users');
    await expect(this.page.getByTestId('view-admin.users')).toBeVisible();
  }

  row(email: string): Locator {
    return this.page.getByTestId(`user-row-${email}`);
  }

  /// Creates a user through the dialog and returns the set-password link it shows.
  async createUser(email: string, displayName: string): Promise<string> {
    await this.newUser.click();
    await this.page.getByTestId('user-email').fill(email);
    await this.page.getByTestId('user-display-name').fill(displayName);
    await this.page.getByTestId('user-form-submit').click();
    await expect(this.linkInput).toBeVisible();
    const link = await this.linkInput.inputValue();
    await this.page.getByTestId('set-password-link-done').click();
    return link;
  }
}

/// /set-password?token=…
export class SetPasswordPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly confirm: Locator;
  readonly submit: Locator;
  readonly done: Locator;
  readonly signIn: Locator;

  constructor(page: Page) {
    this.email = page.getByTestId('set-password-email');
    this.password = page.getByTestId('set-password-password');
    this.confirm = page.getByTestId('set-password-confirm');
    this.submit = page.getByTestId('set-password-submit');
    this.done = page.getByTestId('set-password-done');
    this.signIn = page.getByTestId('set-password-sign-in');
  }

  async setPassword(password: string): Promise<void> {
    await this.password.fill(password);
    await this.confirm.fill(password);
    await this.submit.click();
    await expect(this.done).toBeVisible();
  }
}

/// /profile/tokens: create dialog and the show-once dialog.
export class AccessTokensPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/profile/tokens');
    await expect(this.page.getByTestId('view-profile.tokens')).toBeVisible();
  }

  row(name: string): Locator {
    return this.page.getByTestId(`token-row-${name}`);
  }

  /// Generates a token and returns the secret from the show-once dialog, then closes it.
  async createToken(name: string, scope: 'ReadOnly' | 'ReadWrite' = 'ReadWrite'): Promise<string> {
    await this.page.getByTestId('tokens-new').click();
    await this.page.getByTestId('token-name').fill(name);
    await this.page.getByTestId(`token-scope-${scope}`).click();
    await this.page.getByTestId('token-create').click();
    const secret = this.page.getByTestId('token-secret');
    await expect(secret).toBeVisible();
    const value = await secret.inputValue();
    await this.page.getByTestId('token-copy').click();
    await this.page.getByTestId('token-done').click();
    await expect(secret).toBeHidden();
    return value;
  }
}

/// /admin/flags
export class FeatureFlagsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/admin/flags');
    await expect(this.page.getByTestId('view-admin.flags')).toBeVisible();
  }

  toggle(key: string): Locator {
    return this.page.getByTestId(`flag-toggle-${key}`).getByRole('switch');
  }

  usersOn(key: string): Locator {
    return this.page.getByTestId(`flag-users-on-${key}`);
  }
}
