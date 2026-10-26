import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { AuditLogStore } from './audit-log.store';

@Component({
  selector: 'tk-audit-log-view',
  imports: [PagePlaceholderComponent],
  providers: [AuditLogStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.audit' },
  template: `
    <tk-page-placeholder
      icon="tablerReport"
      title="Audit log"
      viewId="admin.audit"
      description="Who changed users, tokens and flags, and when."
    />
  `,
})
export class AuditLogView {
  protected readonly store = inject(AuditLogStore);

  constructor() {
    this.store.load();
  }
}
