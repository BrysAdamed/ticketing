import { test as base } from '@playwright/test';
import { LoginPage } from '../pages/login.page';
import { ShellPage } from '../pages/shell.page';
import { Api } from './api';
import { ADMIN_STORAGE_STATE } from './env';

interface Fixtures {
  api: Api;
  loginPage: LoginPage;
  shell: ShellPage;
}

/// Base test for every spec: page objects plus an `api` helper signed in as the bootstrap admin.
export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = await Api.create(ADMIN_STORAGE_STATE);
    await use(api);
    await api.dispose();
  },
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  shell: async ({ page }, use) => use(new ShellPage(page)),
});

export { expect } from '@playwright/test';
