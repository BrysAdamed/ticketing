import { Api } from '../../support/api';

export const ACHIEVEMENTS_FLAG = 'achievements';
/// The projector runs every TICKETING_ACHIEVEMENTS_INTERVAL; the e2e stack sets it short.
export const PROJECTOR_TIMEOUT_MS = 120_000;

interface Flag {
    key: string;
    targetUsers: { id: string }[];
}

/// Turns the flag on for these users only, keeping any users other specs targeted.
export async function enableAchievementsFor(api: Api, userIds: string[]): Promise<void> {
    const flag = (await api.get<Flag[]>('/admin/flags')).find((f) => f.key === ACHIEVEMENTS_FLAG);
    if (!flag) {
        await api.post('/admin/flags', {
            key: ACHIEVEMENTS_FLAG,
            description: 'Achievements (TKT-61)',
            enabled: true,
            rolloutPercentage: 0,
            targetUserIds: userIds,
        });
        return;
    }
    const targets = new Set([...flag.targetUsers.map((u) => u.id), ...userIds]);
    await api.patch(`/admin/flags/${ACHIEVEMENTS_FLAG}`, {
        enabled: true,
        targetUserIds: [...targets],
    });
}

/// The highest tier the API's user has earned of an achievement, 0 for none.
export async function tierOf(api: Api, id: string): Promise<number> {
    const { items } = await api.get<{ items: { id: string | null; tier: number }[] }>(
        '/me/achievements',
    );
    return items.find((i) => i.id === id)?.tier ?? 0;
}

export async function unseenCount(api: Api): Promise<number> {
    return (await api.get<{ count: number }>('/me/achievements/unseen')).count;
}
