import { ProjectRole } from '@shared/domain/enums';
import { PROJECT_NAME_MAX_LENGTH } from '@shared/domain/project-key';
import { FIRST_PROJECT_SUGGESTIONS } from './first-project.tour';

export interface OwnedProjectCandidate {
  readonly key: string;
  readonly name: string;
  readonly myRole: ProjectRole | null;
  readonly isMember?: boolean;
  readonly updatedAt?: string;
  readonly archivedAt?: string | null;
}

/// "<display name>'s sandbox", shortened to fit a project name.
export function sandboxName(displayName: string): string {
  const suffix = FIRST_PROJECT_SUGGESTIONS.projectSuffix;
  const owner = displayName.trim() || 'My';
  const name = owner === 'My' ? 'My sandbox' : owner + suffix;
  return name.length <= PROJECT_NAME_MAX_LENGTH
    ? name
    : owner.slice(0, PROJECT_NAME_MAX_LENGTH - suffix.length).trimEnd() + suffix;
}

/// Projects the user owns through an explicit Owner membership and that are not archived (an
/// Admin's implicit Owner role does not count), most recently updated first.
export function ownedProjects<T extends OwnedProjectCandidate>(projects: readonly T[]): T[] {
  return projects
    .filter((p) => p.myRole === 'Owner' && p.isMember !== false && !p.archivedAt)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

/// The project "Use <project>" offers: the one the walkthrough last used while the user still owns
/// it, else the most recently updated owned project.
export function pickWalkthroughProject<T extends OwnedProjectCandidate>(
  owned: readonly T[],
  rememberedKey: string | null,
): T | null {
  return owned.find((p) => p.key === rememberedKey) ?? owned[0] ?? null;
}
