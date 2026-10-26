import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { toApiError } from '@core/api/api-error';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { PAT_SCOPE_LABELS } from '@shared/domain/enums';
import { tokenDisplayState } from '@shared/domain/tokens';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { TokenStatusBadgeComponent } from '@shared/ui/domain/token-status-badge.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AdminToken, AdminUser } from '../admin.models';

export interface UserTokensDialogData {
  user: AdminUser;
  load: () => Promise<AdminToken[]>;
  revoke: (token: AdminToken) => Promise<AdminToken>;
}

/// An Admin's view of one user's tokens (never secrets), with revoke (spec 5.2).
@Component({
  selector: 'tk-user-tokens-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    TokenStatusBadgeComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Access tokens of {{ data.user.displayName }}</h2>
    <mat-dialog-content class="content">
      @if (error(); as message) {
        <tk-empty-state
          icon="tablerAlertCircle"
          tone="danger"
          title="Couldn't load the tokens"
          [description]="message"
        />
      } @else if (tokens(); as list) {
        @for (token of list; track token.id) {
          <div class="row" [attr.data-testid]="'admin-token-row-' + token.name">
            <div class="main">
              <span class="name">{{ token.name }}</span>
              <span class="tk-subtle meta">
                <span class="mono">{{ token.prefix }}…</span> · {{ scopeLabels[token.scope] }} ·
                used
                {{ token.lastUsedAt ? (token.lastUsedAt | relativeTime) : 'never' }}
              </span>
            </div>
            <tk-token-status-badge [token]="token" />
            @if (isLive(token)) {
              <button
                mat-button
                type="button"
                class="revoke"
                [attr.data-testid]="'admin-token-revoke-' + token.name"
                (click)="revoke(token)"
              >
                Revoke
              </button>
            } @else {
              <span class="spacer"></span>
            }
          </div>
        } @empty {
          <tk-empty-state
            icon="tablerKey"
            title="No tokens"
            description="This user has no access tokens from the last 90 days."
          />
        }
      } @else {
        <tk-skeleton-rows [count]="3" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      min-height: 120px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    .main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .name {
      font-weight: var(--tk-weight-medium);
    }
    .meta {
      font-size: var(--tk-text-sm);
    }
    .mono {
      font-family: var(--tk-font-mono);
    }
    .revoke {
      --mat-button-text-label-text-color: var(--tk-danger-fg);
    }
    .spacer {
      width: 72px;
    }
  `,
})
export class UserTokensDialog {
  protected readonly data = inject<UserTokensDialogData>(MAT_DIALOG_DATA);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected readonly scopeLabels = PAT_SCOPE_LABELS;
  protected readonly tokens = signal<AdminToken[] | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    this.data.load().then(
      (tokens) => this.tokens.set(tokens),
      (error: unknown) => this.error.set(toApiError(error).title),
    );
  }

  protected isLive(token: AdminToken): boolean {
    const state = tokenDisplayState(token);
    return state === 'active' || state === 'expiring';
  }

  protected async revoke(token: AdminToken): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Revoke "${token.name}"?`,
      message: `${this.data.user.displayName}'s scripts and MCP clients using this token stop working immediately.`,
      confirmLabel: 'Revoke token',
      danger: true,
    });
    if (!confirmed) return;
    try {
      const revoked = await this.data.revoke(token);
      this.tokens.update((list) => list?.map((t) => (t.id === revoked.id ? revoked : t)) ?? null);
      this.toast.success(`Token "${token.name}" revoked.`);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
