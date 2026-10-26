import { defineView } from '@core/views/view-definition';

export const LOGIN_VIEW = defineView({
  viewId: 'auth.login',
  variants: { default: () => import('./login/login.view').then((m) => m.LoginView) },
});

export const SET_PASSWORD_VIEW = defineView({
  viewId: 'auth.set-password',
  variants: {
    default: () => import('./set-password/set-password.view').then((m) => m.SetPasswordView),
  },
});
