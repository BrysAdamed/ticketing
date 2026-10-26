import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { toApiError } from '@core/api/api-error';
import { PatScope } from '@shared/domain/enums';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { CreatedToken, CreateTokenRequest } from './access-tokens.store';
import { customExpiry, EXPIRY_CHOICES, ExpiryChoice, expiryBounds } from './token-snippets';

export interface CreateTokenDialogData {
  create: (request: CreateTokenRequest) => Promise<CreatedToken>;
}

@Component({
  selector: 'tk-create-token-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Generate access token</h2>
    <form novalidate [formGroup]="form" (ngSubmit)="submit()" data-testid="create-token-form">
      <mat-dialog-content class="content">
        @if (error(); as message) {
          <div class="tk-callout tk-callout-danger" role="alert">
            <tk-icon name="tablerAlertCircle" [size]="16" />
            <span>{{ message }}</span>
          </div>
        }
        <div class="field">
          <label class="tk-field-label" for="token-name">Name</label>
          <mat-form-field>
            <input
              matInput
              id="token-name"
              formControlName="name"
              placeholder="Claude Code laptop"
              cdkFocusInitial
              data-testid="token-name"
            />
            @if (form.controls.name.hasError('required')) {
              <mat-error>Give the token a name you'll recognise.</mat-error>
            } @else if (form.controls.name.hasError('maxlength')) {
              <mat-error>Use at most 100 characters.</mat-error>
            }
          </mat-form-field>
          @if (nameError(); as message) {
            <div class="server-error">{{ message }}</div>
          }
        </div>

        <div class="field">
          <span class="tk-field-label" id="token-scope-label">Scope</span>
          <mat-radio-group
            formControlName="scope"
            aria-labelledby="token-scope-label"
            class="scopes"
          >
            <mat-radio-button value="ReadWrite" data-testid="token-scope-ReadWrite">
              <span class="scope-title">Read & write</span>
              <span class="scope-desc"
                >Everything you can do in the app, through the API and MCP.</span
              >
            </mat-radio-button>
            <mat-radio-button value="ReadOnly" data-testid="token-scope-ReadOnly">
              <span class="scope-title">Read only</span>
              <span class="scope-desc">Search and read; every write is refused.</span>
            </mat-radio-button>
          </mat-radio-group>
        </div>

        <div class="row">
          <div class="field">
            <label class="tk-field-label" for="token-expiry">Expires</label>
            <mat-form-field>
              <mat-select id="token-expiry" formControlName="expiry" data-testid="token-expiry">
                @for (choice of choices; track choice.value) {
                  <mat-option [value]="choice.value">{{ choice.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          @if (form.controls.expiry.value === 'custom') {
            <div class="field">
              <label class="tk-field-label" for="token-expiry-date">Date</label>
              <mat-form-field>
                <input
                  matInput
                  id="token-expiry-date"
                  type="date"
                  formControlName="date"
                  [min]="bounds.min"
                  [max]="bounds.max"
                  data-testid="token-expiry-date"
                />
              </mat-form-field>
              @if (dateError()) {
                <div class="server-error">Pick a date between tomorrow and one year from now.</div>
              }
            </div>
          }
        </div>
        <p class="tk-subtle note">
          Tokens always expire. A token acts with your permissions and can't manage tokens,
          passwords, users or flags.
        </p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" data-testid="token-create" [disabled]="submitting()">
          {{ submitting() ? 'Generating…' : 'Generate token' }}
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
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .scopes {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .scope-title {
      display: block;
      font-weight: var(--tk-weight-medium);
      color: var(--tk-text);
    }
    .scope-desc {
      display: block;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    .server-error {
      margin-top: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-danger-fg);
    }
    .note {
      margin: 0;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class CreateTokenDialog {
  private readonly data = inject<CreateTokenDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<CreateTokenDialog, CreatedToken>>(MatDialogRef);

  protected readonly choices = EXPIRY_CHOICES;
  protected readonly bounds = expiryBounds();
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly nameError = signal<string | null>(null);
  protected readonly dateError = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    scope: ['ReadWrite' as PatScope],
    expiry: [90 as ExpiryChoice],
    date: [''],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const request: CreateTokenRequest = { name: value.name.trim(), scope: value.scope };
    if (value.expiry === 'custom') {
      const expiresAt = customExpiry(value.date);
      this.dateError.set(expiresAt === null);
      if (!expiresAt) return;
      request.expiresAt = expiresAt;
    } else {
      request.expiresInDays = value.expiry;
    }

    this.submitting.set(true);
    this.error.set(null);
    this.nameError.set(null);
    try {
      this.ref.close(await this.data.create(request));
    } catch (error) {
      const apiError = toApiError(error);
      const field = apiError.fieldError('name');
      if (field || apiError.code === 'pat.name.taken') {
        this.nameError.set(field ?? apiError.title);
      } else if (apiError.code === 'pat.limitReached') {
        this.error.set('You already have 20 active tokens. Revoke one you no longer use first.');
      } else {
        this.error.set(apiError.fieldError('expiresAt') ?? apiError.title);
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
