import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { FeatureFlagsStore } from './feature-flags.store';

@Component({
  selector: 'tk-feature-flags-view',
  imports: [PagePlaceholderComponent],
  providers: [FeatureFlagsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.flags' },
  template: `
    <tk-page-placeholder
      icon="tablerFlag"
      title="Feature flags"
      viewId="admin.flags"
      description="Kill switches and gradual rollouts."
    />
  `,
})
export class FeatureFlagsView {
  protected readonly store = inject(FeatureFlagsStore);

  constructor() {
    this.store.load();
  }
}
