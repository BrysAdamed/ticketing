import { APIRequestContext } from '@playwright/test';
import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides';
import { Onboarding } from '@onboarding/onboarding.models';
import { expect, test } from '../../support/fixtures';
import { signInAs } from '../../support/session';
import { PASSWORD, seedUser } from '../identity/identity';

async function onboarding(request: APIRequestContext): Promise<Onboarding> {
    const response = await request.get('/api/v1/me/onboarding');
    expect(response.ok()).toBe(true);
    return (await response.json()) as Onboarding;
}

test.describe('auto-shown guide guard', () => {
    test('a fresh user signed in by the helper has every auto-shown guide completed', async ({
        browser,
        api,
    }) => {
        // Arrange
        const user = await seedUser(api, 'guard');

        // Act
        const { context } = await signInAs(browser, { email: user.email, password: PASSWORD });

        // Assert
        const { guides } = await onboarding(context.request);
        for (const { id, version } of AUTO_SHOWN_GUIDES) {
            expect(guides.find((g) => g.guideId === id)).toMatchObject({
                state: 'Completed',
                version,
            });
        }
        await context.close();
    });

    test('keepGuides leaves every auto-shown guide due', async ({ browser, api }) => {
        // Arrange
        const user = await seedUser(api, 'keep');

        // Act
        const { context } = await signInAs(
            browser,
            { email: user.email, password: PASSWORD },
            { keepGuides: true },
        );

        // Assert
        const { guides } = await onboarding(context.request);
        const autoIds = new Set(AUTO_SHOWN_GUIDES.map((g) => g.id));
        expect(guides.filter((g) => autoIds.has(g.guideId))).toEqual([]);
        await context.close();
    });

    test('the bootstrap admin has every auto-shown guide completed', async ({ api }) => {
        // Act
        const { guides } = await api.get<Onboarding>('/me/onboarding');

        // Assert
        for (const { id, version } of AUTO_SHOWN_GUIDES) {
            const stored = guides.find((g) => g.guideId === id);
            expect(stored?.state).toBe('Completed');
            expect(stored?.version).toBeGreaterThanOrEqual(version);
        }
    });
});
