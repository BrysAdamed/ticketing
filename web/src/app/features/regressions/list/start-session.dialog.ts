import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { RegressionsApi, TestCasesApi } from '@core/testing/testing.api';
import { RegressionSession, TestCaseCounts } from '@core/testing/testing.models';
import { FieldHints } from '@core/tickets/field-hints';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';

export interface StartSessionData {
  projectKey: string;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// "Start regression" dialog (layout-and-screens §3.7): name (default "Regression yyyy-MM-dd"),
/// version with hints, and a preview of how many manual and automatic cases the session will get.
@Component({
  selector: 'tk-start-session-dialog',
  imports: [MatAutocompleteModule, MatButtonModule, MatDialogModule, IconComponent, KbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'start-session-dialog', '(keydown.control.enter)': 'start()', '(keydown.meta.enter)': 'start()' },
  template: `
    <h2 mat-dialog-title>Start regression</h2>
    <mat-dialog-content>
      <label class="tk-field-label" for="session-name">Name</label>
      <input
        id="session-name"
        class="field"
        maxlength="100"
        data-testid="session-name"
        [placeholder]="defaultName"
        [value]="name()"
        (input)="name.set($any($event.target).value)"
      />
      <label class="tk-field-label" for="session-version">Version</label>
      <input
        id="session-version"
        class="field"
        maxlength="50"
        placeholder="For example 2.4.0"
        data-testid="session-version"
        [value]="version()"
        [matAutocomplete]="versions"
        (input)="onVersion($any($event.target).value)"
        (focus)="loadHints(version())"
      />
      <mat-autocomplete #versions="matAutocomplete" (optionSelected)="version.set($event.option.value)">
        @for (hint of hints(); track hint) {
          <mat-option [value]="hint">{{ hint }}</mat-option>
        }
      </mat-autocomplete>
      <div class="summary" data-testid="session-preview">
        @if (counts(); as c) {
          @if (c.manual + c.automatic === 0) {
            <span class="warn"><tk-icon name="tablerAlertTriangle" [size]="14" />No Manual or Automatic test cases yet. Mark test cases Manual or Automatic first.</span>
          } @else {
            <b>{{ c.manual }} manual</b> {{ c.manual === 1 ? 'case' : 'cases' }} will be added as <i>Waiting for execution</i> ·
            <b>{{ c.automatic }} automatic</b> {{ c.automatic === 1 ? 'case' : 'cases' }} will be marked <i>Passed</i>
          }
        } @else {
          <span class="tk-subtle">Counting test cases…</span>
        }
      </div>
      @if (error(); as message) {
        <div class="tk-callout tk-callout-danger" role="alert">{{ message }}</div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" data-testid="session-start" [disabled]="saving() || !canStart()" (click)="start()">
        Start session<tk-kbd tone="on-solid">{{ submitKeys }}</tk-kbd>
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 440px;
    }
    .tk-field-label:not(:first-child) {
      margin-top: 8px;
    }
    .field {
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text);
      font: inherit;
      outline: 0;
    }
    .field:focus {
      border-color: var(--tk-accent);
    }
    .summary {
      margin-top: 14px;
      padding: 10px 12px;
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-subtle);
      color: var(--tk-text-muted);
      line-height: 1.5;
    }
    .summary b {
      color: var(--tk-text);
      font-weight: var(--tk-weight-semibold);
    }
    .warn {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      color: var(--tk-warning-fg);
    }
    .tk-callout {
      margin-top: 10px;
    }
  `,
})
export class StartSessionDialog {
  private readonly data = inject<StartSessionData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<StartSessionDialog, RegressionSession | null>>(MatDialogRef);
  private readonly regressions = inject(RegressionsApi);
  private readonly testCases = inject(TestCasesApi);
  private readonly fieldHints = inject(FieldHints);

  protected readonly defaultName = `Regression ${new Date().toISOString().slice(0, 10)}`;
  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly name = signal('');
  protected readonly version = signal('');
  protected readonly hints = signal<string[]>([]);
  protected readonly counts = signal<TestCaseCounts | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void firstValueFrom(this.testCases.list(this.data.projectKey, { limit: 1 }))
      .then((list) => this.counts.set(list.counts))
      .catch(() => this.counts.set(null));
  }

  protected canStart(): boolean {
    const c = this.counts();
    return c === null || c.manual + c.automatic > 0;
  }

  protected onVersion(value: string): void {
    this.version.set(value);
    void this.loadHints(value);
  }

  protected async loadHints(prefix: string): Promise<void> {
    try {
      this.hints.set(await this.fieldHints.get(this.data.projectKey, 'version', prefix.trim()));
    } catch {
      this.hints.set([]);
    }
  }

  protected async start(): Promise<void> {
    if (this.saving() || !this.canStart()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const session = await firstValueFrom(
        this.regressions.start(
          this.data.projectKey,
          { name: this.name().trim() || null, version: this.version().trim() || null },
          crypto.randomUUID(),
        ),
      );
      this.ref.close(session);
    } catch (error) {
      this.error.set(toApiError(error).title);
    } finally {
      this.saving.set(false);
    }
  }
}
