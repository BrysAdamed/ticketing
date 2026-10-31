import { Api } from '../../support/api';

export const ACHIEVEMENTS_FLAG = 'achievements';
/// The projector runs every TICKETING_ACHIEVEMENTS_INTERVAL; the e2e stack sets it short.
export const PROJECTOR_TIMEOUT_MS = 120_000;

interface Flag {
    key: string;
    enabled: boolean;
    targetUsers: { id: string }[];
    rowVersion: number;
}

interface MyAchievement {
    id: string | null;
    tier: number;
    shared: boolean;
}

/// Turns the flag on for these users, keeping any users other specs targeted. The flag is declared in code, so it always
/// exists (D-168). Specs run in parallel and all edit it, so a patch on a stale row version (409) is retried until the
/// users stick.
export async function enableAchievementsFor(api: Api, userIds: string[]): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        const flag = await api.get<Flag>(`/admin/flags/${ACHIEVEMENTS_FLAG}`);
        const current = new Set(flag.targetUsers.map((u) => u.id));
        if (flag.enabled && userIds.every((id) => current.has(id))) return;
        try {
            await api.patch(
                `/admin/flags/${ACHIEVEMENTS_FLAG}`,
                {
                    enabled: true,
                    targetUserIds: [...new Set([...current, ...userIds])],
                },
                flag.rowVersion,
            );
        } catch (error) {
            if (!/→ (409|412) /.test(String(error))) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100 + Math.random() * 400));
    }
    throw new Error(`Could not target ${userIds.join(', ')} with the ${ACHIEVEMENTS_FLAG} flag.`);
}

/// The caller's achievement `id`; the first call stamps their start of counting.
export async function myAchievement(api: Api, id: string): Promise<MyAchievement | undefined> {
    const { items } = await api.get<{ items: MyAchievement[] }>('/me/achievements');
    return items.find((i) => i.id === id);
}

/// The highest tier the API's user has earned of an achievement, 0 for none.
export async function tierOf(api: Api, id: string): Promise<number> {
    return (await myAchievement(api, id))?.tier ?? 0;
}

export async function unseenCount(api: Api): Promise<number> {
    return (await api.get<{ count: number }>('/me/achievements/unseen')).count;
}
