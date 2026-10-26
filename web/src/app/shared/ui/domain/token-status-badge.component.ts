import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  expiresInLabel,
  PatSummary,
  tokenDisplayState,
  TokenDisplayState,
} from '@shared/domain/tokens';
import { BadgeComponent, BadgeTone } from './badge.component';

const STATES: Record<TokenDisplayState, { tone: BadgeTone; label: string }> = {
  active: { tone: 'green', label: 'Active' },
  expiring: { tone: 'amber', label: 'Expiring' },
  expired: { tone: 'red', label: 'Expired' },
  revoked: { tone: 'muted', label: 'Revoked' },
};

/// Personal access token state: Active, Expiring (within 7 days, with the days left), Expired, Revoked.
@Component({
  selector: 'tk-token-status-badge',
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<tk-badge [tone]="view().tone" [dot]="true" [attr.data-state]="state()">{{
    view().label
  }}</tk-badge>`,
})
export class TokenStatusBadgeComponent {
  readonly token = input.required<Pick<PatSummary, 'status' | 'expiresAt' | 'revokedAt'>>();

  protected readonly state = computed(() => tokenDisplayState(this.token()));
  protected readonly view = computed(() => {
    const state = this.state();
    return state === 'expiring'
      ? { tone: STATES.expiring.tone, label: `Expires ${expiresInLabel(this.token().expiresAt)}` }
      : STATES[state];
  });
}
