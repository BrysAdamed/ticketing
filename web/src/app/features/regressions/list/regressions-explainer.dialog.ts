import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { provideIcons } from '@ng-icons/core';
import {
  tablerBug,
  tablerChecklist,
  tablerPlayerPlay,
  tablerUserCheck,
} from '@ng-icons/tabler-icons';
import { IconComponent } from '@shared/ui/icon/icon.component';

interface ExplainerStep {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly ExplainerStep[] = [
  {
    icon: 'tablerChecklist',
    title: 'Write test cases',
    body: 'Manual cases have steps someone follows; Automatic ones pass by themselves. Cases still New are not ready and stay out.',
  },
  {
    icon: 'tablerPlayerPlay',
    title: 'Start a session',
    body: 'Pick a version. Every Manual and Automatic case becomes an item, a snapshot later edits do not change. Automatic items start as passed.',
  },
  {
    icon: 'tablerUserCheck',
    title: 'Take and record items',
    body: 'Take an item so others know it is yours, then record Pass, Fail (with what actually happened) or Skip.',
  },
  {
    icon: 'tablerBug',
    title: 'Turn a failure into a bug',
    body: 'A failed item offers a bug with the steps, the version and your note filled in. It lands at the top of the backlog.',
  },
];

/// "How regressions work" (coordinator decision 7): the regressions list has no tour, so its empty
/// state explains the flow in four steps. Loaded on first open.
@Component({
  selector: 'tk-regressions-explainer-dialog',
  imports: [MatDialogModule, MatButtonModule, IconComponent],
  viewProviders: [provideIcons({ tablerBug, tablerChecklist, tablerPlayerPlay, tablerUserCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'regressions-explainer' },
  template: `
    <h2 mat-dialog-title id="regressions-explainer-title">How regressions work</h2>
    <mat-dialog-content>
      <ol class="steps">
        @for (step of steps; track step.title) {
          <li>
            <span class="ic"><tk-icon [name]="step.icon" [size]="16" /></span>
            <span class="text">
              <b>{{ step.title }}</b>
              <span class="body">{{ step.body }}</span>
            </span>
          </li>
        }
      </ol>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-flat-button
        type="button"
        mat-dialog-close
        data-testid="regressions-explainer-close"
      >
        Got it
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    li {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .ic {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-subtle);
      color: var(--tk-text-muted);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .body {
      color: var(--tk-text-muted);
    }
  `,
})
export class RegressionsExplainerDialog {
  protected readonly steps = STEPS;
}
