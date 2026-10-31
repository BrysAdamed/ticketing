import {
  MutedProject,
  NotificationKindPreference,
  NotificationPreferences,
  NotificationPreferencesChange,
} from '@core/notifications/notification-preferences.api';
import { NotificationKind } from '@core/notifications/notification.models';
import { ProjectSummary } from '@core/projects/project-directory';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';

export interface KindCopy {
  label: string;
  description: string;
}

export const KIND_COPY: Readonly<Record<NotificationKind, KindCopy>> = {
  Mentioned: {
    label: 'Mentions',
    description: 'Someone @mentions you in a description or comment.',
  },
  Assigned: {
    label: 'Assignments',
    description: 'A ticket is created for you or handed over to you.',
  },
  RegressionItemAssigned: {
    label: 'Regression items',
    description: 'Someone assigns you a test case in a regression run.',
  },
  Commented: {
    label: 'Comments',
    description: 'New comments on tickets you watch and on docs you wrote or commented on.',
  },
  StatusChanged: { label: 'Status changes', description: 'A ticket you watch changes status.' },
  PriorityRaised: {
    label: 'Priority raised',
    description: 'A ticket you watch is raised to High or Highest.',
  },
  Moved: {
    label: 'Moves',
    description: 'A ticket you watch moves between the backlog and boards.',
  },
  Deleted: { label: 'Deletions', description: 'A ticket you watch is deleted.' },
};

const ORDER: readonly NotificationKind[] = [
  'Mentioned',
  'Assigned',
  'RegressionItemAssigned',
  'Commented',
  'StatusChanged',
  'PriorityRaised',
  'Moved',
  'Deleted',
];

export interface KindGroups {
  direct: NotificationKindPreference[];
  following: NotificationKindPreference[];
}

/// Splits the kinds into the ones addressed to you and the ones about things you follow, in display order.
export function groupKinds(kinds: readonly NotificationKindPreference[]): KindGroups {
  const sorted = [...kinds].sort((a, b) => rank(a.kind) - rank(b.kind));
  return {
    direct: sorted.filter((k) => k.direct),
    following: sorted.filter((k) => !k.direct),
  };
}

function rank(kind: NotificationKind): number {
  const index = ORDER.indexOf(kind);
  return index < 0 ? ORDER.length : index;
}

export type PreferenceEdit =
  | { type: 'kind'; kind: NotificationKind; muted: boolean }
  | { type: 'project'; project: MutedProject; muted: boolean };

export function invertEdit(edit: PreferenceEdit): PreferenceEdit {
  return { ...edit, muted: !edit.muted };
}

/// The optimistic state after an edit; the server's answer replaces it once no other edit is pending.
export function applyEdit(
  preferences: NotificationPreferences,
  edit: PreferenceEdit,
): NotificationPreferences {
  if (edit.type === 'kind') {
    return {
      ...preferences,
      kinds: preferences.kinds.map((k) => (k.kind === edit.kind ? { ...k, muted: edit.muted } : k)),
    };
  }
  const others = preferences.mutedProjects.filter((p) => p.id !== edit.project.id);
  const mutedProjects = edit.muted
    ? [...others, edit.project].sort((a, b) => a.key.localeCompare(b.key))
    : others;
  return { ...preferences, mutedProjects };
}

export function toChange(edit: PreferenceEdit): NotificationPreferencesChange {
  if (edit.type === 'kind') {
    return edit.muted ? { muteKinds: [edit.kind] } : { unmuteKinds: [edit.kind] };
  }
  return edit.muted ? { muteProjects: [edit.project.id] } : { unmuteProjects: [edit.project.id] };
}

/// Readable projects that are not muted yet, by key; archived ones last.
export function projectsToMute(
  projects: readonly ProjectSummary[],
  muted: readonly MutedProject[],
): PickerOption<MutedProject>[] {
  const mutedIds = new Set(muted.map((p) => p.id));
  return projects
    .filter((p) => !mutedIds.has(p.id))
    .sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || a.key.localeCompare(b.key))
    .map((p) => ({
      value: { id: p.id, key: p.key, name: p.name },
      label: `${p.key} · ${p.name}`,
      keywords: [p.key, p.name],
    }));
}
