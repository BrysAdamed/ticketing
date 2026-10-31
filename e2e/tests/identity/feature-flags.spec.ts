import { FeatureFlagsPage } from '../../pages/identity.page';
import { expect, test } from '../../support/fixtures';

/// `agent.delegate` is declared in code with default off (D-168). It is instance-wide, so this
/// spec runs in the serial `agents` project with the other specs that switch it.
const KEY = 'agent.delegate';

interface Flag {
    key: string;
    enabled: boolean;
    rolloutPercentage: number;
    defaultOn: boolean | null;
    isDefault: boolean;
}

test.describe('feature flags', () => {
    test.beforeEach(async ({ api }) => {
        await api.post(`/admin/flags/${KEY}/reset`);
    });

    test.afterEach(async ({ api }) => {
        await api.post(`/admin/flags/${KEY}/reset`);
    });

    test('every declared flag is listed with its default and there is no New flag', async ({
        page,
        api,
    }) => {
        // Arrange
        const flags = new FeatureFlagsPage(page);
        const declared = await api.get<Flag[]>('/admin/flags');

        // Act
        await flags.goto();

        // Assert
        for (const flag of declared.filter((f) => f.defaultOn !== null)) {
            await expect(flags.row(flag.key)).toBeVisible();
            await expect(flags.defaultChip(flag.key)).toHaveText(
                `Default: ${flag.defaultOn ? 'on' : 'off'}`,
            );
        }
        await expect(flags.changed(KEY)).toHaveCount(0);
        await expect(page.getByRole('button', { name: /new flag/i })).toHaveCount(0);
    });

    test('admin toggles a flag and it applies to /me/flags at once', async ({ page, api }) => {
        // Arrange
        await api.patch(`/admin/flags/${KEY}`, { rolloutPercentage: 100 });
        const flags = new FeatureFlagsPage(page);
        await flags.goto();
        await expect(flags.toggle(KEY)).not.toBeChecked();

        // Act
        await flags.toggle(KEY).click();

        // Assert
        await expect(flags.toggle(KEY)).toBeChecked();
        await expect(
            page.getByTestId('toast').filter({ hasText: `${KEY} turned on` }),
        ).toBeVisible();
        await expect
            .poll(async () => (await api.get<Flag>(`/admin/flags/${KEY}`)).enabled)
            .toBe(true);
        const mine = await api.get<{ flags: Record<string, string> }>('/me/flags');
        expect(mine.flags[KEY]).toBe('on');
        await expect(flags.usersOn(KEY)).not.toHaveText(/^\s*0\s*\//);
        await expect(flags.changed(KEY)).toBeVisible();
    });

    test('reset to default restores the code default', async ({ page, api }) => {
        // Arrange
        await api.patch(`/admin/flags/${KEY}`, { enabled: true, targetRoles: ['Admin'] });
        const flags = new FeatureFlagsPage(page);
        await flags.goto();
        await expect(flags.changed(KEY)).toBeVisible();

        // Act
        await flags.reset(KEY);

        // Assert
        await expect(flags.toggle(KEY)).not.toBeChecked();
        await expect(flags.changed(KEY)).toHaveCount(0);
        const flag = await api.get<Flag>(`/admin/flags/${KEY}`);
        expect([flag.enabled, flag.rolloutPercentage, flag.isDefault]).toEqual([false, 0, true]);
    });
});
