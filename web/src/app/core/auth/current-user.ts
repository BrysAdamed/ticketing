import { GlobalRole } from '@shared/domain/enums';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  /// The user opted out of achievements (spec 15.11).
  achievementsHidden: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}
