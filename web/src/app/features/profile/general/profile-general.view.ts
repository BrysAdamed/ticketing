import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { ProfileGeneralStore } from './profile-general.store';

@Component({
  selector: 'tk-profile-general-view',
  imports: [PagePlaceholderComponent],
  providers: [ProfileGeneralStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-profile.general' },
  template: `
    <tk-page-placeholder
      icon="tablerUserCircle"
      title="Profile"
      viewId="profile.general"
      description="Your name, email and password."
    />
  `,
})
export class ProfileGeneralView {
  protected readonly store = inject(ProfileGeneralStore);

  constructor() {
    this.store.load();
  }
}
