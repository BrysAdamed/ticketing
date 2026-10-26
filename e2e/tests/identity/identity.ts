import { Api } from '../../support/api';

export const PASSWORD = 'Purple-Elephant-Dances-42';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@ticketing.test`;
}

interface CreatedUser {
  user: { id: string; email: string; displayName: string };
  setPasswordLink: { token: string; path: string };
}

/// Seeds an active user with a password through the real endpoints (admin create + set-password link).
export async function seedUser(api: Api, prefix = 'e2e'): Promise<{ id: string; email: string; displayName: string }> {
  const email = uniqueEmail(prefix);
  const created = await api.post<CreatedUser>('/admin/users', { email, displayName: `E2E ${prefix}` });
  await api.post('/auth/set-password', { token: created.setPasswordLink.token, password: PASSWORD });
  return created.user;
}
