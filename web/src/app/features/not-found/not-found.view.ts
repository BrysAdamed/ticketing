import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { ContextualHintComponent } from '@core/onboarding/hints/contextual-hint.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { NotFoundStore } from './not-found.store';

@Component({
  selector: 'tk-not-found-view',
  imports: [ContextualHintComponent, EmptyStateComponent, MatButtonModule, RouterLink],
  providers: [NotFoundStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-app.not-found' },
  template: `
    <tk-empty-state icon="tablerAlertTriangle" title="Page not found" [description]="store.message">
      <a mat-flat-button routerLink="/my-work">Go to My work</a>
    </tk-empty-state>
    <tk-contextual-hint class="hint" hint="hint.private-404" />
  `,
  styles: `
    .hint {
      max-width: 480px;
      margin: -32px auto 0;
      padding: 0 16px;
    }
  `,
})
export class NotFoundView {
  protected readonly store = inject(NotFoundStore);
}
