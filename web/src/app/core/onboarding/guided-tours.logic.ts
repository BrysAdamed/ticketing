import { ProjectRole } from '@shared/domain/enums';
import type { TourResult } from './engine/tour-launcher';
import { TourAccess } from './engine/tour.model';
import { GuideState } from './onboarding.models';

/// What the user may do in the project on screen (spec 5.3): Owners and Members write to projects
/// that are not archived. Outside a project only `admin` steps can apply.
export function tourAccess(
  project: { readonly role: ProjectRole | null; readonly archived: boolean } | null,
  isAdmin: boolean,
): TourAccess {
  const role = project?.role ?? null;
  return {
    canWrite: (role === 'Owner' || role === 'Member') && !project?.archived,
    isOwner: role === 'Owner',
    isAdmin,
  };
}

/// The project a tour started away from its view runs in: the one in context, else the most
/// recently updated project the user can write to, else the most recently updated readable one.
export function pickTourProject(
  projects: readonly TourProject[],
  currentKey: string | null,
): string | null {
  return rankTourProjects(projects, currentKey)[0] ?? null;
}

export interface TourProject {
  readonly key: string;
  readonly myRole: ProjectRole | null;
  readonly updatedAt?: string;
  readonly archivedAt?: string | null;
}

/// The projects a tour looks in for something to open, best first: the one in context, then the
/// active projects the user can write to, then the active readable ones, each most recently
/// updated first.
export function rankTourProjects(
  projects: readonly TourProject[],
  currentKey: string | null,
): string[] {
  const active = projects
    .filter((p) => !p.archivedAt)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const writable = (p: TourProject) => p.myRole === 'Owner' || p.myRole === 'Member';
  const ranked = [...active.filter(writable), ...active.filter((p) => !writable(p))].map(
    (p) => p.key,
  );
  if (!currentKey) return ranked;
  const current = currentKey.toUpperCase();
  return [currentKey, ...ranked.filter((k) => k.toUpperCase() !== current)];
}

/// What a finished tour stores: Done on the last step completes it, Esc or Skip dismisses it.
/// A tour that did not start (`aborted`) or gave way to another screen (`interrupted`) stores
/// nothing, so it stays new.
export function storedTourState(result: TourResult): GuideState | null {
  switch (result) {
    case 'completed':
      return 'Completed';
    case 'dismissed':
      return 'Dismissed';
    default:
      return null;
  }
}
