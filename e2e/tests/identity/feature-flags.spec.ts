import { FeatureFlagsPage } from '../../pages/identity.page';
import { expect, test } from '../../support/fixtures';

interface Flag {
  key: string;
  enabled: boolean;
  usersOn: number;
}

test('admin toggles a flag and it applies to /me/flags at once', async ({ page, api }) => {
  // Arrange
  const key = `e2e.flag-${Date.now().toString(36)}`;
  await api.post('/admin/flags', { key, description: 'E2E flag', rolloutPercentage: 100 });
  const flags = new FeatureFlagsPage(page);
  await flags.goto();
  await expect(flags.toggle(key)).not.toBeChecked();

  // Act
  await flags.toggle(key).click();

  // Assert
  await expect(flags.toggle(key)).toBeChecked();
  await expect(page.getByTestId('toast')).toContainText(`${key} turned on`);
  await expect
    .poll(async () => (await api.get<Flag>(`/admin/flags/${key}`)).enabled)
    .toBe(true);
  const mine = await api.get<{ flags: Record<string, string> }>('/me/flags');
  expect(mine.flags[key]).toBe('on');
  await expect(flags.usersOn(key)).not.toHaveText(/^\s*0\s*\//);
  await api.delete(`/admin/flags/${key}`);
});
