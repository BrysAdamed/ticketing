import {
  provideHttpClient,
  withFetch,
  withInterceptors,
  withXsrfConfiguration,
} from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { MAT_RIPPLE_GLOBAL_OPTIONS } from '@angular/material/core';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { apiErrorInterceptor } from '@core/api/api-error.interceptor';
import { AuthService } from '@core/auth/auth.service';
import { providePeekView } from '@core/layout/peek/peek';
import { ThemeService } from '@core/theme/theme.service';
import { provideTicketCreation } from '@core/tickets/create-ticket';
import { TICKET_DETAIL_VIEW } from '@features/tickets/tickets.views';
import { APP_ICONS } from '@shared/ui/icon/app-icons';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    provideHttpClient(
      withFetch(),
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
      withInterceptors([apiErrorInterceptor]),
    ),
    provideAppInitializer(() => {
      inject(ThemeService);
      return inject(AuthService).initialize();
    }),
    provideIcons(APP_ICONS),
    providePeekView(TICKET_DETAIL_VIEW),
    provideTicketCreation(() => import('@features/tickets/create/create-ticket.dialog').then((m) => m.CreateTicketDialog)),
    { provide: MAT_RIPPLE_GLOBAL_OPTIONS, useValue: { disabled: true } },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic', hideRequiredMarker: true },
    },
    {
      provide: MAT_TOOLTIP_DEFAULT_OPTIONS,
      useValue: {
        showDelay: 500,
        hideDelay: 0,
        touchendHideDelay: 0,
        disableTooltipInteractivity: true,
      },
    },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: { duration: 5000, horizontalPosition: 'end', verticalPosition: 'bottom' },
    },
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: {
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        hasBackdrop: true,
        maxWidth: 'calc(100vw - 32px)',
      },
    },
  ],
};
