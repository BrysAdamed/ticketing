import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { fillText } from '../engine/tour-logic';
import { FIRST_PROJECT_CHOICE } from './first-project.tour';

export interface FirstProjectChoiceData {
  readonly projectName: string;
}

/// What the walkthrough runs on, for a user who already owns a project (spec 14.4 step 0).
export type FirstProjectChoice = 'use' | 'create';

/// Step 0 of the "Your first project" walkthrough: use the owned project or create a practice one.
/// Closing it any other way cancels the walkthrough.
@Component({
  selector: 'tk-first-project-choice-dialog',
  imports: [MatDialogModule, MatButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'first-project-choice' },
  template: `
    <h2 mat-dialog-title class="title">
      <span class="icon" aria-hidden="true"><tk-icon name="tablerRoute" [size]="14" /></span>
      {{ copy.title }}
    </h2>
    <mat-dialog-content>
      <p class="body">{{ text(copy.body) }}</p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" mat-dialog-close>{{ copy.cancel }}</button>
      <span class="spacer"></span>
      <button
        mat-stroked-button
        type="button"
        data-testid="first-project-create"
        [mat-dialog-close]="'create'"
      >
        {{ copy.create }}
      </button>
      <button
        mat-flat-button
        type="button"
        data-testid="first-project-use"
        cdkFocusInitial
        [mat-dialog-close]="'use'"
      >
        {{ text(copy.use) }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      display: flex;
      align-items: center;
      gap: var(--tk-space-2);
    }
    .icon {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-accent-subtle);
      color: var(--tk-accent-fg);
    }
    .body {
      margin: 0;
      color: var(--tk-text-muted);
    }
    .spacer {
      flex: 1;
    }
  `,
})
export class FirstProjectChoiceDialog {
  private readonly data = inject<FirstProjectChoiceData>(MAT_DIALOG_DATA);
  protected readonly copy = FIRST_PROJECT_CHOICE;

  protected text(template: string): string {
    return fillText(template, { projectName: this.data.projectName });
  }
}
