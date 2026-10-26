import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { LOGIN_VIEW, SET_PASSWORD_VIEW } from './auth.views';

export const LOGIN_ROUTES: Routes = [viewRoute(LOGIN_VIEW, { path: '' })];

export const SET_PASSWORD_ROUTES: Routes = [viewRoute(SET_PASSWORD_VIEW, { path: '' })];
