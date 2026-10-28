import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { provideIcons } from '@ng-icons/core';
import { tablerRocket, tablerSparkles } from '@ng-icons/tabler-icons';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { AuthService } from '../../auth/auth.service';
import { ShortcutService } from '../../shortcuts/shortcut.service';
import { WELCOME_COPY, welcomeCards } from './welcome.copy';

/// Which action closed the welcome dialog; Esc, × and the backdrop close it with `undefined`.
export type WelcomeChoice = 'tour' | 'checklist';

/// The welcome dialog (spec 14.2): three cards tailored to the role, Take the tour and Show me the
/// checklist. `OnboardingDialogs` opens it, records the result and runs the chosen action.
@Component({
  selector: 'tk-welcome-dialog',
  imports: [MatDialogModule, MatButtonModule, IconComponent, KbdComponent],
  viewProviders: [provideIcons({ tablerRocket, tablerSparkles })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'welcome-dialog' },
  template: `
    <button
      type="button"
      class="tk-icon-btn close"
      [attr.aria-label]="copy.close"
      data-testid="welcome-close"
      (click)="ref.close()"
    >
      <tk-icon name="tablerX" [size]="16" />
    </button>
    <div class="head">
      <div class="eyebrow"><tk-icon name="tablerSparkles" [size]="14" />{{ copy.eyebrow }}</div>
      <h2 mat-dialog-title class="title" id="welcome-title">{{ title() }}</h2>
      <p class="intro">{{ isAdmin() ? copy.adminIntro : copy.intro }}</p>
    </div>
    <mat-dialog-content class="cards">
      @for (card of cards(); track card.id; let first = $first) {
        <div
          class="card"
          [class.lead]="first && card.steps"
          [attr.data-testid]="'welcome-card-' + card.id"
        >
          <span class="ic"><tk-icon [name]="card.icon" [size]="16" /></span>
          <div class="text">
            <b
              >{{ card.title }}
              @if (card.keys) {
                <tk-kbd data-testid="welcome-palette-keys">{{ keyLabel(card.keys) }}</tk-kbd>
              }
            </b>
            @if (card.body) {
              <span class="body">{{ card.body }}</span>
            }
            @if (card.steps) {
              <ul>
                @for (step of card.steps; track step.text) {
                  <li><tk-icon [name]="step.icon" [size]="14" />{{ step.text }}</li>
                }
              </ul>
            }
          </div>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions class="foot">
      <span class="note">{{ copy.note }}</span>
      <span class="right">
        <button
          mat-stroked-button
          type="button"
          data-testid="welcome-checklist"
          (click)="ref.close('checklist')"
        >
          {{ copy.checklist }}
        </button>
        <button
          mat-flat-button
          type="button"
          cdkFocusInitial
          data-testid="welcome-tour"
          (click)="ref.close('tour')"
        >
          <tk-icon name="tablerCompass" [size]="14" />{{ copy.tour }}
        </button>
      </span>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .close {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 1;
    }
    .head {
      padding: 22px 24px 6px;
    }
    .eyebrow {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      color: var(--tk-accent-fg);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
    }
    .title.title {
      padding: 0;
      margin: 0 0 4px;
      font-size: var(--tk-text-xl);
      line-height: var(--tk-leading-xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
    }
    .title::before {
      display: none;
    }
    .intro {
      margin: 0;
      color: var(--tk-text-muted);
    }
    .cards.cards {
      display: grid;
      gap: 8px;
      padding: 14px 24px 4px;
    }
    .card {
      display: flex;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      background: var(--tk-surface);
    }
    .ic {
      width: 32px;
      height: 32px;
      flex: none;
      display: grid;
      place-items: center;
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-muted);
      color: var(--tk-text-muted);
    }
    .text b {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: var(--tk-weight-semibold);
      color: var(--tk-text);
    }
    .body {
      display: block;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
    }
    .card.lead {
      border-color: var(--tk-accent-border);
      background: var(--tk-accent-subtle);
    }
    .card.lead .ic {
      background: var(--tk-accent);
      color: var(--tk-text-on-solid);
    }
    ul {
      display: grid;
      gap: 2px;
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .foot.foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 24px 20px;
    }
    .note {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .right {
      display: flex;
      gap: 8px;
      margin-left: auto;
    }
    .right tk-icon {
      margin-right: 6px;
    }
  `,
})
export class WelcomeDialog {
  protected readonly ref = inject<MatDialogRef<WelcomeDialog, WelcomeChoice>>(MatDialogRef);
  private readonly auth = inject(AuthService);
  private readonly shortcuts = inject(ShortcutService);

  protected readonly copy = WELCOME_COPY;
  protected readonly isAdmin = this.auth.isAdmin;
  protected readonly cards = computed(() => welcomeCards(this.isAdmin()));
  protected readonly title = computed(() =>
    WELCOME_COPY.title.replace('{name}', this.auth.currentUser()?.displayName ?? ''),
  );

  protected keyLabel(keys: string): string {
    return this.shortcuts.format(keys).join(' ');
  }
}
