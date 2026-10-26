import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { AdminUsersStore } from './admin-users.store';

@Component({
  selector: 'tk-admin-users-view',
  imports: [PagePlaceholderComponent],
  providers: [AdminUsersStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.users' },
  template: `
    <tk-page-placeholder
      icon="tablerUsers"
      title="Users"
      viewId="admin.users"
      description="Create, deactivate and manage users."
    />
  `,
})
export class AdminUsersView {
  protected readonly store = inject(AdminUsersStore);

  constructor() {
    this.store.load();
  }
}
