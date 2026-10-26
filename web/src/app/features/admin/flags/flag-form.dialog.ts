import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSliderModule } from '@angular/material/slider';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { toApiError } from '@core/api/api-error';
import { GLOBAL_ROLES, GlobalRole } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { FeatureFlag, FlagInput, UserLookup } from '../admin.models';
import { UserSearchComponent } from '../shared/user-search.component';
import { FLAG_KEY_PATTERN } from './flag-summary';

export interface FlagFormDialogData {
  flag?: FeatureFlag;
  submit: (key: string, input: FlagInput) => Promise<FeatureFlag>;
}

const MAX_TARGET_USERS = 200;

@Component({
  selector: 'tk-flag-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSliderModule,
    MatSlideToggleModule,
    AvatarComponent,
    IconComponent,
    UserSearchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ data.flag ? data.flag.key : 'New feature flag' }}</h2>
    <form novalidate [formGroup]="form" (ngSubmit)="submit()" data-testid="flag-form">
      <mat-dialog-content class="content">
        @if (error(); as message) {
          <div class="tk-callout tk-callout-danger" role="alert">
            <tk-icon name="tablerAlertCircle" [size]="16" />
            <span>{{ message }}</span>
          </div>
        }
        @if (!data.flag) {
          <div class="field">
            <label class="tk-field-label" for="flag-key">Key</label>
            <mat-form-field>
              <input
                matInput
                id="flag-key"
                class="mono"
                formControlName="key"
                placeholder="board.swimlanes"
                autocomplete="off"
                data-testid="flag-key"
              />
              @if (form.controls.key.hasError('required')) {
                <mat-error>Enter a key.</mat-error>
              } @else if (
                form.controls.key.hasError('pattern') || form.controls.key.hasError('maxlength')
              ) {
                <mat-error
                  >Lower-case words separated by "." or "-", for example ticket-view.v2.</mat-error
                >
              }
            </mat-form-field>
            @if (keyError(); as message) {
              <div class="server-error">{{ message }}</div>
            } @else {
              <div class="hint">Code reads the flag by this key. It can't be changed later.</div>
            }
          </div>
        }
        <div class="field">
          <label class="tk-field-label" for="flag-description">Description</label>
          <mat-form-field>
            <textarea
              matInput
              id="flag-description"
              rows="2"
              formControlName="description"
              data-testid="flag-description"
            ></textarea>
          </mat-form-field>
        </div>

        <div class="switch-row">
          <mat-slide-toggle
            formControlName="enabled"
            aria-labelledby="flag-enabled-label"
            data-testid="flag-enabled"
          />
          <span id="flag-enabled-label"
            >Enabled
            <span class="tk-subtle">(master switch; off means off for everyone)</span></span
          >
        </div>

        <fieldset class="targeting">
          <legend class="tk-field-label">Who gets it when enabled</legend>
          <div class="rollout">
            <span class="label">Rollout</span>
            <mat-slider min="0" max="100" step="5" discrete class="slider">
              <input
                matSliderThumb
                formControlName="rolloutPercentage"
                aria-label="Rollout percentage"
              />
            </mat-slider>
            <input
              type="number"
              min="0"
              max="100"
              class="pct tnum"
              formControlName="rolloutPercentage"
              aria-label="Rollout percentage"
              data-testid="flag-rollout"
            />
            <span class="tk-muted">%</span>
          </div>
          <p class="tk-subtle hint">
            Users are bucketed by a stable hash of the flag key and their id, so the same users stay
            in as the percentage grows.
          </p>

          <div class="roles">
            <span class="label">Roles</span>
            @for (role of roles; track role) {
              <mat-checkbox
                [checked]="targetRoles().includes(role)"
                (change)="toggleRole(role, $event.checked)"
                [attr.data-testid]="'flag-role-' + role"
              >
                {{ role === 'Admin' ? 'Admins' : 'Users' }}
              </mat-checkbox>
            }
          </div>

          <div class="users">
            <span class="label">Users</span>
            <div class="picker">
              <div class="chips">
                @for (user of targetUsers(); track user.id) {
                  <span class="chip" [attr.data-testid]="'flag-target-' + user.email">
                    <tk-avatar
                      [userId]="user.id"
                      [name]="user.displayName"
                      [size]="20"
                      [showTitle]="false"
                    />
                    {{ user.displayName }}
                    <button
                      type="button"
                      class="tk-icon-btn tk-icon-btn-sm"
                      [attr.aria-label]="'Remove ' + user.displayName"
                      (click)="removeUser(user)"
                    >
                      <tk-icon name="tablerX" [size]="12" />
                    </button>
                  </span>
                }
              </div>
              @if (targetUsers().length < maxUsers) {
                <tk-user-search
                  placeholder="Add a user by name or email"
                  testId="flag-user-search"
                  [exclude]="targetUserIds()"
                  (picked)="addUser($event)"
                />
              }
            </div>
          </div>
        </fieldset>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button
          mat-flat-button
          type="submit"
          data-testid="flag-form-submit"
          [disabled]="submitting()"
        >
          {{ submitting() ? 'Saving…' : data.flag ? 'Save' : 'Create flag' }}
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
    .mono {
      font-family: var(--tk-font-mono);
    }
    .hint {
      margin: 4px 0 0;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-subtle);
    }
    .server-error {
      margin-top: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-danger-fg);
    }
    .switch-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .targeting {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      padding: 8px 14px 14px;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .label {
      width: 64px;
      flex: none;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .rollout,
    .roles,
    .users {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .users {
      align-items: flex-start;
    }
    .users .label {
      padding-top: 6px;
    }
    .slider {
      flex: 1;
    }
    .pct {
      width: 56px;
      height: 28px;
      padding: 0 6px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text);
      font: inherit;
      text-align: right;
    }
    .picker {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .chips:empty {
      display: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 24px;
      padding: 0 2px 0 2px;
      border: 1px solid var(--tk-border);
      border-radius: 12px;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class FlagFormDialog {
  protected readonly data = inject<FlagFormDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<FlagFormDialog, FeatureFlag>>(MatDialogRef);

  protected readonly roles = GLOBAL_ROLES;
  protected readonly maxUsers = MAX_TARGET_USERS;
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly keyError = signal<string | null>(null);
  protected readonly targetUsers = signal<UserLookup[]>([...(this.data.flag?.targetUsers ?? [])]);
  protected readonly targetRoles = signal<GlobalRole[]>([...(this.data.flag?.targetRoles ?? [])]);

  protected readonly form = inject(NonNullableFormBuilder).group({
    key: [
      this.data.flag?.key ?? '',
      [Validators.required, Validators.maxLength(64), Validators.pattern(FLAG_KEY_PATTERN)],
    ],
    description: [this.data.flag?.description ?? '', Validators.maxLength(500)],
    enabled: [this.data.flag?.enabled ?? false],
    rolloutPercentage: [
      this.data.flag?.rolloutPercentage ?? 0,
      [Validators.min(0), Validators.max(100)],
    ],
  });

  protected targetUserIds(): string[] {
    return this.targetUsers().map((u) => u.id);
  }

  protected addUser(user: UserLookup): void {
    if (!this.targetUserIds().includes(user.id)) this.targetUsers.update((list) => [...list, user]);
  }

  protected removeUser(user: UserLookup): void {
    this.targetUsers.update((list) => list.filter((u) => u.id !== user.id));
  }

  protected toggleRole(role: GlobalRole, checked: boolean): void {
    this.targetRoles.update((list) =>
      checked ? [...new Set([...list, role])] : list.filter((r) => r !== role),
    );
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const input: FlagInput = {
      description: value.description.trim() || null,
      enabled: value.enabled,
      rolloutPercentage: Math.round(Number(value.rolloutPercentage)),
      targetUserIds: this.targetUserIds(),
      targetRoles: this.targetRoles(),
    };
    this.submitting.set(true);
    this.error.set(null);
    this.keyError.set(null);
    try {
      this.ref.close(await this.data.submit(value.key.trim(), input));
    } catch (error) {
      const apiError = toApiError(error);
      const key = apiError.fieldError('key');
      if (key) this.keyError.set(key);
      else
        this.error.set(
          apiError.code === 'concurrency.conflict'
            ? 'Someone else changed this flag. The list was reloaded; open it again.'
            : apiError.title,
        );
    } finally {
      this.submitting.set(false);
    }
  }
}
