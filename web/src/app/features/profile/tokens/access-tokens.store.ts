import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { LoadStatus } from '@core/projects/project-directory';
import { ToastService } from '@core/notify/toast.service';
import { PatScope } from '@shared/domain/enums';
import { PatSummary } from '@shared/domain/tokens';

export interface CreateTokenRequest {
  name: string;
  scope: PatScope;
  expiresInDays?: number;
  expiresAt?: string;
}

/// `POST /me/tokens`: the token and its secret, which is shown once and never kept.
export interface CreatedToken {
  token: PatSummary;
  secret: string;
}

export const MAX_ACTIVE_TOKENS = 20;

@Injectable()
export class AccessTokensStore {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);

  readonly tokens = signal<readonly PatSummary[]>([]);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly activeCount = computed(() => this.tokens().filter((t) => t.status === 'Active').length);
  readonly atLimit = computed(() => this.activeCount() >= MAX_ACTIVE_TOKENS);

  async load(): Promise<void> {
    this.status.set('loading');
    try {
      this.tokens.set(await firstValueFrom(this.api.get<PatSummary[]>('/me/tokens')));
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  /// Throws ApiError so the dialog can show field errors.
  async create(request: CreateTokenRequest): Promise<CreatedToken> {
    const created = await firstValueFrom(this.api.post<CreatedToken>('/me/tokens', request));
    this.tokens.update((list) => [created.token, ...list]);
    return created;
  }

  async revoke(token: PatSummary): Promise<void> {
    const previous = this.tokens();
    this.tokens.update((list) =>
      list.map((t) =>
        t.id === token.id ? { ...t, status: 'Revoked', revokedAt: new Date().toISOString() } : t,
      ),
    );
    try {
      const revoked = await firstValueFrom(
        this.api.post<PatSummary>(`/me/tokens/${token.id}/revoke`),
      );
      this.tokens.update((list) => list.map((t) => (t.id === revoked.id ? revoked : t)));
      this.toast.success(`Token "${token.name}" revoked.`);
    } catch (error) {
      this.tokens.set(previous);
      this.toast.error(error, { action: { label: 'Retry', run: () => void this.revoke(token) } });
    }
  }
}
