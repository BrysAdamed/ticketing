import { ApiError } from '@core/api/api-error';

/// A user-administration rule the server refused (spec 4.1, D-41), phrased for the dialog.
export interface UserRuleProblem {
  title: string;
  message: string;
  projects: readonly string[];
}

export function describeUserRule(error: ApiError, displayName: string): UserRuleProblem | null {
  switch (error.code) {
    case 'user.lastAdmin':
      return {
        title: 'The last administrator stays',
        message: `${displayName} is the last active administrator. Make another user an Admin first.`,
        projects: [],
      };
    case 'user.lastProjectOwner':
      return {
        title: `${displayName} still owns projects`,
        message: `${displayName} is the only active owner of the projects below. Add another owner to each of them, then deactivate again.`,
        projects: error.fieldErrors['projects'] ?? [],
      };
    case 'user.selfRoleChange':
      return {
        title: "You can't change your own role",
        message: 'Ask another administrator to do it.',
        projects: [],
      };
    case 'user.selfDeactivation':
      return {
        title: "You can't deactivate yourself",
        message: 'Ask another administrator to do it.',
        projects: [],
      };
    case 'user.inactive':
      return {
        title: `${displayName} is deactivated`,
        message: 'Reactivate the user before issuing a set-password link.',
        projects: [],
      };
    default:
      return null;
  }
}
