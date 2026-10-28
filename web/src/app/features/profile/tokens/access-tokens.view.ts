import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '@core/notify/confirm.service';
import { CONNECT_AGENT_QUERY, isConnectAgentGuide } from '@core/onboarding/agent/connect-agent';
import { PAT_SCOPE_LABELS } from '@shared/domain/enums';
import { PatSummary, tokenDisplayState } from '@shared/domain/tokens';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { TokenStatusBadgeComponent } from '@shared/ui/domain/token-status-badge.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AccessTokensStore, CreatedToken, MAX_ACTIVE_TOKENS } from './access-tokens.store';
import { ConnectAgentGuideComponent } from './connect-agent-guide.component';
import { CreateTokenDialog, CreateTokenDialogData } from './create-token.dialog';
import { TokenCreatedDialog } from './token-created.dialog';

@Component({
  selector: 'tk-access-tokens-view',
  imports: [
    MatButtonModule,
    MatTableModule,
    MatTooltip,
    IconComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    TokenStatusBadgeComponent,
    ConnectAgentGuideComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  providers: [AccessTokensStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-profile.tokens' },
  templateUrl: './access-tokens.view.html',
  styleUrl: './access-tokens.view.scss',
})
export class AccessTokensView {
  protected readonly store = inject(AccessTokensStore);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryParams = toSignal(this.route.queryParamMap);
  private readonly newToken = viewChild('newToken', { read: ElementRef<HTMLButtonElement> });

  protected readonly guideOpen = computed(() =>
    isConnectAgentGuide(this.queryParams()?.get('guide')),
  );

  protected readonly scopeLabels = PAT_SCOPE_LABELS;
  protected readonly maxTokens = MAX_ACTIVE_TOKENS;
  protected readonly columns = [
    'name',
    'prefix',
    'scope',
    'status',
    'created',
    'lastUsed',
    'expires',
    'actions',
  ];

  constructor() {
    void this.store.load();
  }

  protected scopeLabel(token: PatSummary): string {
    return this.scopeLabels[token.scope];
  }

  protected isLive(token: PatSummary): boolean {
    const state = tokenDisplayState(token);
    return state === 'active' || state === 'expiring';
  }

  protected async create(): Promise<void> {
    const created = await firstValueFrom(
      this.dialog
        .open<CreateTokenDialog, CreateTokenDialogData, CreatedToken>(CreateTokenDialog, {
          width: '480px',
          data: { create: (request) => this.store.create(request) },
        })
        .afterClosed(),
    );
    if (!created) return;
    this.dialog.open(TokenCreatedDialog, {
      width: '600px',
      data: created,
      disableClose: true,
      autoFocus: 'first-tabbable',
    });
  }

  protected openGuide(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: CONNECT_AGENT_QUERY,
      queryParamsHandling: 'merge',
    });
  }

  protected closeGuide(): void {
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { guide: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .then(() => this.newToken()?.nativeElement.focus());
  }

  protected async revoke(token: PatSummary): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Revoke "${token.name}"?`,
      message:
        'Scripts and MCP clients using this token stop working immediately. This cannot be undone.',
      confirmLabel: 'Revoke token',
      danger: true,
    });
    if (confirmed) await this.store.revoke(token);
  }
}
