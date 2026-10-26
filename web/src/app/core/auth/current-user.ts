import { GlobalRole } from '@shared/domain/enums';

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}
