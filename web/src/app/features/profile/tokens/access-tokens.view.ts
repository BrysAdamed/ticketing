import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { AccessTokensStore } from './access-tokens.store';

@Component({
  selector: 'tk-access-tokens-view',
  imports: [PagePlaceholderComponent],
  providers: [AccessTokensStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-profile.tokens' },
  template: `
    <tk-page-placeholder
      icon="tablerKey"
      title="Access tokens"
      viewId="profile.tokens"
      description="Personal access tokens for the REST API and the MCP server."
    />
  `,
})
export class AccessTokensView {
  protected readonly store = inject(AccessTokensStore);

  constructor() {
    this.store.load();
  }
}
