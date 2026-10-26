import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { UserRuleProblem } from './user-errors';

/// Explains a refused user action (last admin, last project owner, self change) with next steps.
@Component({
  selector: 'tk-user-rule-dialog',
  imports: [MatDialogModule, MatButtonModule, RouterLink, IconComponent, ProjectTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="title">
      <tk-icon name="tablerAlertTriangle" [size]="20" class="warn" />
      {{ data.title }}
    </h2>
    <mat-dialog-content>
      <p class="message" data-testid="user-rule-message">{{ data.message }}</p>
      @if (data.projects.length > 0) {
        <ul class="projects" data-testid="user-rule-projects">
          @for (key of data.projects; track key) {
            <li>
              <a
                [routerLink]="['/projects', key, 'settings']"
                mat-dialog-close
                [attr.data-testid]="'user-rule-project-' + key"
              >
                <tk-project-tile [projectKey]="key" />
                <span>{{ key }}</span>
                <span class="tk-subtle go">Members</span>
                <tk-icon name="tablerArrowRight" [size]="14" />
              </a>
            </li>
          }
        </ul>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" mat-dialog-close data-testid="user-rule-ok">OK</button>
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .warn {
      color: var(--tk-warning-fg);
    }
    .message {
      margin: 0 0 12px;
      color: var(--tk-text-muted);
    }
    .projects {
      list-style: none;
      margin: 0;
      padding: 0;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
    }
    .projects li + li {
      border-top: 1px solid var(--tk-border-subtle);
    }
    .projects a {
      height: 36px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      color: var(--tk-text);
      font-weight: var(--tk-weight-medium);
    }
    .projects a:hover {
      background: var(--tk-bg-hover);
    }
    .go {
      margin-left: auto;
      font-weight: var(--tk-weight-regular);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class UserRuleDialog {
  protected readonly data = inject<UserRuleProblem>(MAT_DIALOG_DATA);
}
