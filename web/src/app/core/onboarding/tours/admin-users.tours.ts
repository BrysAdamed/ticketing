import { TourDefinition } from '../engine/tour.model';

/// Tour of Admin → Users for instance Admins (spec 5.2, 6.14, 14.4): create a user, hand over the
/// set-password link, read the status column, the row actions, finding people. Every step needs
/// `admin`, and the catalogue offers the tour to Admins only.
export const ADMIN_USERS_TOUR: TourDefinition = {
  id: 'tour.admin.users',
  version: 1,
  viewId: 'admin.users',
  title: 'Users',
  steps: [
    {
      id: 'new',
      anchor: 'admin-users.new',
      requires: 'admin',
      placement: 'start',
      title: 'Create a user',
      body: 'Enter an email, a display name and a role. You get a set-password link, valid for 72 hours, to pass on yourself: no email is sent, and you never see their password.',
    },
    {
      id: 'table',
      anchor: 'admin-users.table',
      requires: 'admin',
      placement: 'above',
      title: 'Everyone on this instance',
      body: 'Admins manage users, flags and the audit log and are Owners of every project. Users see the projects they are members of and every public one.',
    },
    {
      id: 'status',
      anchor: 'admin-users.status',
      requires: 'admin',
      title: 'Status',
      body: 'Invited users have an unused link; Link expired means they need a new one. Locked clears itself after 15 minutes. Deactivated users cannot sign in.',
    },
    {
      id: 'actions',
      anchor: 'admin-users.actions',
      requires: 'admin',
      placement: 'start',
      title: 'Links, roles and access',
      body: 'Edit a name or role, issue a new set-password link (also for a forgotten password), review access tokens, or deactivate. Users are never deleted.',
    },
    {
      id: 'filters',
      anchor: 'admin-users.filters',
      requires: 'admin',
      title: 'Find someone',
      body: 'Search by name or email and filter by status or role.',
    },
  ],
};
