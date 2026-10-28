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
  TitleStrategy,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { apiErrorInterceptor } from '@core/api/api-error.interceptor';
import { AuthService } from '@core/auth/auth.service';
import { PageTitleStrategy } from '@core/layout/page-title';
import { provideConnectAgentHelp } from '@core/onboarding/agent/connect-agent.help';
import { provideGettingStartedHelp } from '@core/onboarding/checklist/getting-started.help';
import { providePeekView } from '@core/layout/peek/peek';
import { provideOnboardingDialogs } from '@core/onboarding/onboarding-dialogs';
import { provideGuidedTours } from '@core/onboarding/tour-availability';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { provideTicketCreation } from '@core/tickets/create-ticket';
import { provideTicketHeaderAction } from '@core/tickets/ticket-header-actions';
import { provideTicketDetailSection } from '@core/tickets/ticket-sections';
import { provideAttachments } from '@features/attachments/attachments.providers';
import { provideDocsTicketSection } from '@features/docs/docs.providers';
import { provideSearch } from '@features/search/search.providers';
import { TICKET_DETAIL_VIEW } from '@features/tickets/tickets.views';
import { DIAGRAM_THEME } from '@shared/diagrams/diagram-theme.token';
import { APP_ICONS } from '@shared/ui/icon/app-icons';
import { PICKER_SHORTCUT_AVAILABLE } from '@shared/ui/inline-picker/picker-option';
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
    provideSearch(),
    provideGuidedTours(),
    provideGettingStartedHelp(),
    provideConnectAgentHelp(),
    provideOnboardingDialogs(),
    provideAttachments(),
    provideDocsTicketSection(),
    provideTicketCreation(() =>
      import('@features/tickets/create/create-ticket.dialog').then((m) => m.CreateTicketDialog),
    ),
    provideTicketDetailSection({
      id: 'test-cases',
      order: 10,
      title: 'Test cases',
      loadComponent: () =>
        import('@features/test-cases/ticket-section/ticket-test-cases.component').then(
          (m) => m.TicketTestCasesComponent,
        ),
    }),
    provideTicketHeaderAction({
      id: 'delegate',
      order: 10,
      loadComponent: () =>
        import('@features/agent-delegation/delegate-action.component').then(
          (m) => m.DelegateActionComponent,
        ),
    }),
    { provide: TitleStrategy, useExisting: PageTitleStrategy },
    {
      provide: PICKER_SHORTCUT_AVAILABLE,
      useFactory: () => {
        const shortcuts = inject(ShortcutService);
        return (keys: string) => shortcuts.isRegistered(keys);
      },
    },
    { provide: DIAGRAM_THEME, useFactory: () => inject(ThemeService).theme },
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
