import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { SetPasswordStore } from './set-password.store';

@Component({
  selector: 'tk-set-password-view',
  imports: [EmptyStateComponent, MatButtonModule, RouterLink],
  providers: [SetPasswordStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-auth.set-password' },
  template: `
    <main class="card">
      <tk-empty-state
        icon="tablerShieldLock"
        title="Set your password"
        [description]="
          token()
            ? 'Choosing a password from a set-password link is not built yet.'
            : 'This link is missing its token. Ask an administrator for a new link.'
        "
      >
        <a mat-stroked-button routerLink="/login">Back to sign in</a>
      </tk-empty-state>
    </main>
  `,
  styles: `
    :host {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 48px 16px;
      background: var(--tk-bg-sidebar);
    }
    .card {
      width: 100%;
      max-width: 400px;
      background: var(--tk-surface);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-xl);
      box-shadow: var(--tk-shadow-sm);
    }
    .card tk-empty-state {
      margin: 32px auto;
    }
  `,
})
export class SetPasswordView {
  protected readonly store = inject(SetPasswordStore);

  readonly token = input<string | null>(null);

  constructor() {
    effect(() => this.store.load({ token: this.token() }));
  }
}
