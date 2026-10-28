import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { toApiError } from '@core/api/api-error';
import { CreateProjectPrefill } from '@core/projects/create-project';
import { ProjectDetail } from '@core/projects/project-context';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ProjectVisibility } from '@shared/domain/enums';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { VisibilityCardsComponent } from '@shared/ui/domain/visibility-cards.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  normalizeProjectKeyInput,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  projectKeyError,
  suggestProjectKey,
} from '@shared/domain/project-key';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// "New project" dialog (layout-and-screens §3.1): the key is derived from the name until the
/// user edits it, upper-cased and validated as they type. Closes with the created project.
@Component({
  selector: 'tk-new-project-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    IconComponent,
    KbdComponent,
    VisibilityCardsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
  template: `
    <h2 mat-dialog-title>New project</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate data-testid="new-project-form">
      <mat-dialog-content class="content">
        @if (error(); as message) {
          <div class="tk-callout tk-callout-danger" role="alert">
            <tk-icon name="tablerAlertCircle" [size]="16" />
            <span>{{ message }}</span>
          </div>
        }
        <div class="field">
          <label class="tk-field-label" for="new-project-name">Name</label>
          <mat-form-field>
            <input
              matInput
              id="new-project-name"
              formControlName="name"
              autocomplete="off"
              placeholder="Customer portal"
              data-testid="new-project-name"
              [attr.maxlength]="nameMax"
            />
            @if (form.controls.name.hasError('required')) {
              <mat-error>Enter a name.</mat-error>
            } @else if (form.controls.name.hasError('server')) {
              <mat-error>{{ form.controls.name.getError('server') }}</mat-error>
            }
          </mat-form-field>
        </div>
        <div class="field">
          <label class="tk-field-label" for="new-project-key">Key</label>
          <mat-form-field>
            <input
              matInput
              id="new-project-key"
              class="key-input tnum"
              formControlName="key"
              autocomplete="off"
              spellcheck="false"
              placeholder="CP"
              data-testid="new-project-key"
              [attr.maxlength]="keyMax"
              (input)="onKeyInput($any($event.target).value)"
            />
            @if (form.controls.key.errors; as errors) {
              <mat-error data-testid="new-project-key-error">{{
                errors['server'] ?? errors['taken'] ?? errors['key']
              }}</mat-error>
            } @else {
              <mat-hint>
                Ticket keys will look like
                <strong class="tnum">{{ form.controls.key.value || 'KEY' }}-1</strong>. The key
                can't be changed later.
              </mat-hint>
            }
          </mat-form-field>
        </div>
        <div class="field">
          <span class="tk-field-label" id="new-project-visibility">Visibility</span>
          <tk-visibility-cards
            labelledBy="new-project-visibility"
            [value]="form.controls.visibility.value"
            (valueChange)="form.controls.visibility.setValue($event)"
          />
        </div>
        <div class="field">
          <label class="tk-field-label" for="new-project-description">
            Description <span class="tk-subtle">(optional, markdown)</span>
          </label>
          <mat-form-field>
            <textarea
              matInput
              id="new-project-description"
              formControlName="description"
              rows="3"
              data-testid="new-project-description"
            ></textarea>
          </mat-form-field>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <span class="hint"
          ><tk-kbd>{{ submitKeys }}</tk-kbd> to create</span
        >
        <button mat-button type="button" (click)="ref.close()">Cancel</button>
        <button
          mat-flat-button
          type="submit"
          data-testid="new-project-submit"
          [disabled]="submitting()"
        >
          {{ submitting() ? 'Creating…' : 'Create project' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .field mat-form-field {
      width: 100%;
    }
    .key-input {
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .hint {
      margin-right: auto;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
  `,
})
export class NewProjectDialog {
  private readonly api = inject(ApiClient);
  private readonly directory = inject(ProjectDirectory);
  protected readonly ref = inject<MatDialogRef<NewProjectDialog, ProjectDetail>>(MatDialogRef);
  private readonly prefill = inject<CreateProjectPrefill | null>(MAT_DIALOG_DATA, {
    optional: true,
  });

  protected readonly nameMax = PROJECT_NAME_MAX_LENGTH;
  protected readonly keyMax = PROJECT_KEY_MAX_LENGTH;
  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly idempotencyKey = crypto.randomUUID();
  private keyEdited = false;

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    key: new FormControl('', {
      nonNullable: true,
      validators: [(c) => this.validateKey(c)],
    }),
    visibility: new FormControl<ProjectVisibility>('Private', { nonNullable: true }),
    description: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      if (!this.keyEdited) this.form.controls.key.setValue(suggestProjectKey(name));
    });
    const { name, key, visibility } = this.prefill ?? {};
    if (name) this.form.controls.name.setValue(name);
    if (key) this.form.controls.key.setValue(key);
    if (visibility) this.form.controls.visibility.setValue(visibility);
  }

  protected onKeyInput(raw: string): void {
    const normalized = normalizeProjectKeyInput(raw);
    this.keyEdited = normalized.length > 0;
    if (normalized !== raw) this.form.controls.key.setValue(normalized);
    this.form.controls.key.markAsTouched();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.submit();
    }
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const { name, key, visibility, description } = this.form.getRawValue();
    this.submitting.set(true);
    this.error.set(null);
    try {
      const project = await firstValueFrom(
        this.api.post<ProjectDetail>(
          '/projects',
          { key, name: name.trim(), visibility, description: description.trim() || null },
          { idempotencyKey: this.idempotencyKey },
        ),
      );
      this.ref.close(project);
    } catch (e) {
      this.showError(e);
    } finally {
      this.submitting.set(false);
    }
  }

  private showError(e: unknown): void {
    const error = toApiError(e);
    const { name, key } = this.form.controls;
    if (error.code === 'project.key.taken' || error.fieldError('key')) {
      key.setErrors({ server: error.fieldError('key') ?? error.title });
    } else if (error.code === 'project.name.taken' || error.fieldError('name')) {
      name.setErrors({ server: error.fieldError('name') ?? error.title });
    } else {
      this.error.set(error.title);
    }
  }

  private validateKey(control: AbstractControl<string>): ValidationErrors | null {
    const message = projectKeyError(control.value);
    if (message) return { key: message };
    if (this.directory?.byKey(control.value))
      return { taken: `${control.value} is already used by another project.` };
    return null;
  }
}
