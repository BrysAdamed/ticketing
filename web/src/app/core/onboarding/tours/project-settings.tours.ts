import { TourDefinition } from '../engine/tour.model';

/// Tour of a project's settings for its Owners (spec 5.3, 6.5, 14.4): name and description,
/// visibility, adding members, roles, archiving. Every step needs `owner`, and the catalogue offers
/// the tour to Owners only (Admins are Owners everywhere).
export const PROJECT_SETTINGS_TOUR: TourDefinition = {
  id: 'tour.project.settings',
  version: 1,
  viewId: 'project.settings',
  title: 'Project settings',
  steps: [
    {
      id: 'general',
      anchor: 'project-settings.general',
      requires: 'owner',
      placement: 'end',
      title: 'Name and description',
      body: 'Rename the project or describe it in Markdown. The key never changes, so ticket keys and links stay valid.',
    },
    {
      id: 'visibility',
      anchor: 'project-settings.visibility',
      requires: 'owner',
      title: 'Private or public',
      body: 'A private project is visible to its members only; to anyone else it does not exist (not found). Public lets every signed-in user see and edit it.',
    },
    {
      id: 'add-member',
      anchor: 'project-settings.add-member',
      requires: 'owner',
      title: 'Add people',
      body: 'Find someone by name or email and pick a role. Owners manage the project, Members create and edit tickets, Viewers only read.',
    },
    {
      id: 'members',
      anchor: 'project-settings.members',
      requires: 'owner',
      placement: 'above',
      title: 'Members and roles',
      body: 'Change a role or remove someone here. A project always keeps at least one Owner.',
    },
    {
      id: 'danger-zone',
      anchor: 'project-settings.danger-zone',
      requires: 'owner',
      placement: 'above',
      title: 'Archive',
      body: 'Archiving makes the project read-only and can be undone. Only Admins can delete an archived project, and its key stays reserved.',
    },
  ],
};
