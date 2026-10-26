import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { NotFoundStore } from './not-found.store';

@Component({
  selector: 'tk-not-found-view',
  imports: [EmptyStateComponent, MatButtonModule, RouterLink],
  providers: [NotFoundStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-app.not-found' },
  template: `
    <tk-empty-state icon="tablerAlertTriangle" title="Page not found" [description]="store.message">
      <a mat-flat-button routerLink="/my-work">Go to My work</a>
    </tk-empty-state>
  `,
})
export class NotFoundView {
  protected readonly store = inject(NotFoundStore);
}
