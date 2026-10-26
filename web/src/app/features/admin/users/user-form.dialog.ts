import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { toApiError } from '@core/api/api-error';
import { GlobalRole } from '@shared/domain/enums';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AdminUser } from '../admin.models';
import { UserFormValue } from './admin-users.store';

export interface UserFormDialogData {
  user?: AdminUser;
  isSelf?: boolean;
  submit: (value: UserFormValue) => Promise<unknown>;
}

/// Create (email, name, role) or edit (name, role) a user. Closes with the submit result.
@Component({
  selector: 'tk-user-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.user ? 'Edit ' + data.user.displayName : 'New user' }}</h2>
    <form novalidate [formGroup]="form" (ngSubmit)="submit()" data-testid="user-form">
      <mat-dialog-content class="content">
        @if (error(); as message) {
          <div class="tk-callout tk-callout-danger" role="alert">
            <tk-icon name="tablerAlertCircle" [size]="16" />
            <span>{{ message }}</span>
          </div>
        }
        <div class="field">
          <label class="tk-field-label" for="user-email">Email</label>
          <mat-form-field>
            <input
              matInput
              id="user-email"
              type="email"
              formControlName="email"
              autocomplete="off"
              data-testid="user-email"
              [readonly]="!!data.user"
            />
            @if (form.controls.email.hasError('required')) {
              <mat-error>Enter an email address.</mat-error>
            } @else if (form.controls.email.hasError('email')) {
              <mat-error>Enter a valid email address.</mat-error>
            }
          </mat-form-field>
          @if (fieldErrors()['email']; as message) {
            <div class="server-error">{{ message }}</div>
          } @else if (!data.user) {
            <div class="hint">This is the sign-in name. It can't be changed later.</div>
          }
        </div>
        <div class="field">
          <label class="tk-field-label" for="user-name">Display name</label>
          <mat-form-field>
            <input
              matInput
              id="user-name"
              formControlName="displayName"
              autocomplete="off"
              data-testid="user-display-name"
            />
            @if (form.controls.displayName.hasError('required')) {
              <mat-error>Enter a display name.</mat-error>
            }
          </mat-form-field>
          @if (fieldErrors()['displayName']; as message) {
            <div class="server-error">{{ message }}</div>
          }
        </div>
        <div class="field">
          <span class="tk-field-label" id="user-role-label">Global role</span>
          <mat-radio-group
            formControlName="globalRole"
            aria-labelledby="user-role-label"
            class="roles"
          >
            <mat-radio-button value="User" data-testid="user-role-User">
              <span class="role-title">User</span>
              <span class="role-desc"
                >Creates projects and boards, works in projects they can access.</span
              >
            </mat-radio-button>
            <mat-radio-button value="Admin" data-testid="user-role-Admin">
              <span class="role-title">Admin</span>
              <span class="role-desc"
                >Everything a user can do, plus users, tokens, flags and Owner access to every
                project.</span
              >
            </mat-radio-button>
          </mat-radio-group>
          @if (data.isSelf) {
            <div class="hint">You can't change your own role.</div>
          }
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button
          mat-flat-button
          type="submit"
          data-testid="user-form-submit"
          [disabled]="submitting()"
        >
          {{ submitting() ? 'Saving…' : data.user ? 'Save' : 'Create user' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .field mat-form-field {
      width: 100%;
    }
    .roles {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .role-title {
      display: block;
      font-weight: var(--tk-weight-medium);
      color: var(--tk-text);
    }
    .role-desc,
    .hint {
      display: block;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    .hint {
      margin-top: 4px;
      color: var(--tk-text-subtle);
    }
    .server-error {
      margin-top: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-danger-fg);
    }
  `,
})
export class UserFormDialog {
  protected readonly data = inject<UserFormDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<UserFormDialog, unknown>>(MatDialogRef);

  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string | null>>({});

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: [
      this.data.user?.email ?? '',
      [Validators.required, Validators.email, Validators.maxLength(254)],
    ],
    displayName: [
      this.data.user?.displayName ?? '',
      [Validators.required, Validators.maxLength(100)],
    ],
    globalRole: [
      { value: this.data.user?.globalRole ?? ('User' as GlobalRole), disabled: !!this.data.isSelf },
    ],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.fieldErrors.set({});
    try {
      const value = this.form.getRawValue();
      this.ref.close(
        await this.data.submit({
          ...value,
          email: value.email.trim(),
          displayName: value.displayName.trim(),
        }),
      );
    } catch (error) {
      const apiError = toApiError(error);
      const email = apiError.fieldError('email');
      const displayName = apiError.fieldError('displayName');
      this.fieldErrors.set({ email, displayName });
      if (!email && !displayName) this.error.set(apiError.title);
    } finally {
      this.submitting.set(false);
    }
  }
}
