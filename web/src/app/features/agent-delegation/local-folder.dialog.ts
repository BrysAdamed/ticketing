import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { localFolderError } from '@core/agent/claude-deep-link';

export interface LocalFolderDialogData {
  projectKey: string;
  repositoryUrl: string | null;
  current: string | null;
  /// Label of the primary button, for example "Save and open Claude Code".
  submitLabel: string;
  /// Called synchronously from the button's click handler, so a launch it starts keeps the user gesture.
  save: (folder: string) => void;
}

/// Asks for the absolute path of the local clone of a project (refinement §6, D-97): browsers
/// cannot reveal paths from a folder picker, so it is a validated text field, kept in this browser.
@Component({
  selector: 'tk-local-folder-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-folder-dialog' },
  template: `
    <h2 mat-dialog-title>Where is your clone of {{ data.projectKey }}?</h2>
    <mat-dialog-content>
      <p class="lead">
        Claude Code starts in this folder. Enter the absolute path of your clone of
      </p>
      @if (data.repositoryUrl; as url) {
        <code class="repo" data-testid="agent-folder-repository">{{ url }}</code>
      }
      <label class="tk-field-label" for="agent-folder-path">Local folder</label>
      <mat-form-field>
        <input
          matInput
          id="agent-folder-path"
          autocomplete="off"
          spellcheck="false"
          placeholder="C:\\src\\ticketing"
          data-testid="agent-folder-input"
          [value]="path()"
          (input)="path.set($any($event.target).value); touched.set(true)"
          (keydown.enter)="submit()"
        />
      </mat-form-field>
      @if (touched() && error(); as message) {
        <div class="error" role="alert" data-testid="agent-folder-error">{{ message }}</div>
      }
      <p class="note">
        Every prompt first runs <code>git remote get-url origin</code> in this folder and stops if
        it doesn't match the repository above. The path is saved in this browser only; Ticketing
        never receives it.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        data-testid="agent-folder-save"
        [disabled]="touched() && !!error()"
        (click)="submit()"
      >
        {{ data.submitLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      max-width: 520px;
    }
    .lead {
      margin: 0 0 6px;
      color: var(--tk-text-muted);
    }
    .repo {
      display: block;
      margin-bottom: 14px;
      padding: 6px 8px;
      border-radius: var(--tk-radius-sm);
      background: var(--tk-bg-subtle);
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      overflow-wrap: anywhere;
    }
    mat-form-field {
      width: 100%;
    }
    .error {
      margin-top: 4px;
      color: var(--tk-danger-fg);
      font-size: var(--tk-text-sm);
    }
    .note {
      margin: 12px 0 0;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .note code {
      font-family: var(--tk-font-mono);
    }
  `,
})
export class LocalFolderDialog {
  protected readonly data = inject<LocalFolderDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<LocalFolderDialog>);

  protected readonly path = signal(this.data.current ?? '');
  protected readonly touched = signal(false);
  protected readonly error = computed(() => localFolderError(this.path()));

  protected submit(): void {
    this.touched.set(true);
    if (this.error()) return;
    this.ref.close();
    this.data.save(this.path().trim());
  }
}
