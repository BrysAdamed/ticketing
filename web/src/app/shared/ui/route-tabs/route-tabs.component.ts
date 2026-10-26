import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface RouteTab {
  path: string;
  label: string;
  exact?: boolean;
}

/// Tab bar whose tabs are child routes. Project the `<router-outlet />` as content.
@Component({
  selector: 'tk-route-tabs',
  imports: [MatTabsModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav mat-tab-nav-bar class="tk-tab-nav" [tabPanel]="panel" [attr.aria-label]="ariaLabel()">
      @for (tab of tabs(); track tab.path) {
        <a
          mat-tab-link
          [routerLink]="tab.path"
          routerLinkActive
          #rla="routerLinkActive"
          [routerLinkActiveOptions]="{ exact: tab.exact ?? false }"
          [active]="rla.isActive"
          [attr.data-testid]="testIdPrefix() + (tab.path || 'index')"
        >
          {{ tab.label }}
        </a>
      }
    </nav>
    <mat-tab-nav-panel #panel>
      <ng-content />
    </mat-tab-nav-panel>
  `,
})
export class RouteTabsComponent {
  readonly tabs = input.required<readonly RouteTab[]>();
  readonly ariaLabel = input('Sections');
  readonly testIdPrefix = input('tab-');
}
