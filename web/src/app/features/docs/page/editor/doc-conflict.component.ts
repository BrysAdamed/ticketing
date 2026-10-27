import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { EditConflict } from '../../editing/doc-edit-session';
import { LineRange } from '../../editing/three-way-merge';

interface ConflictLine {
  number: number;
  text: string;
  clash: boolean;
}

/// Overlapping concurrent edits (spec 1.7): the latest published text ("Theirs") and mine side by
/// side with the clashing lines marked, and the three ways out (two for drawings).
@Component({
  selector: 'tk-doc-conflict',
  imports: [MatButtonModule, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'doc-conflict-title' },
  template: `
    <header class="head">
      <tk-icon class="warn" name="tablerAlertTriangle" [size]="20" />
      <div class="what">
        <h2 id="doc-conflict-title">Your changes overlap with v{{ conflict().theirs.version }}</h2>
        <p>
          {{ conflict().theirs.updatedBy.displayName }} published
          {{ conflict().theirs.updatedAt | relativeTime }} while you were editing.
          @if (textual()) {
            {{ conflict().regions.length }}
            {{ conflict().regions.length === 1 ? 'part clashes' : 'parts clash' }}; nothing is lost.
          } @else {
            Drawings can't be merged: publish yours over theirs (theirs stays in history) or discard
            yours.
          }
        </p>
      </div>
      <div class="actions">
        @if (textual()) {
          <button
            mat-stroked-button
            type="button"
            data-testid="conflict-keep"
            (click)="keep.emit()"
          >
            Keep editing on latest
          </button>
        }
        <button
          mat-stroked-button
          type="button"
          data-testid="conflict-overwrite"
          [disabled]="busy()"
          (click)="overwrite.emit()"
        >
          Overwrite with mine
        </button>
        <button mat-button type="button" data-testid="conflict-discard" (click)="discard.emit()">
          Discard mine
        </button>
      </div>
    </header>
    <div class="panes">
      <section aria-label="Theirs">
        <div class="label">Theirs (v{{ conflict().theirs.version }})</div>
        @if (textual()) {
          <pre
            data-testid="conflict-theirs"
          >@for (line of theirs(); track line.number) {<span class="ln" [class.clash]="line.clash"><i>{{ line.number }}</i>{{ line.text }}
</span>}</pre>
        } @else {
          <div class="rendered" data-testid="conflict-theirs"><ng-content select="[theirs]" /></div>
        }
      </section>
      <section aria-label="Mine">
        <div class="label">Mine</div>
        @if (textual()) {
          <pre
            data-testid="conflict-mine"
          >@for (line of mine(); track line.number) {<span class="ln" [class.clash]="line.clash"><i>{{ line.number }}</i>{{ line.text }}
</span>}</pre>
        } @else {
          <div class="rendered" data-testid="conflict-mine"><ng-content select="[mine]" /></div>
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      background: var(--tk-bg);
    }
    .head {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--tk-warning-border);
      background: var(--tk-warning-bg);
    }
    .warn {
      margin-top: 2px;
      color: var(--tk-warning-fg);
    }
    .what {
      flex: 1;
      min-width: 0;
    }
    h2 {
      margin: 0;
      font-size: var(--tk-text-md);
      font-weight: var(--tk-weight-semibold);
    }
    p {
      margin: 2px 0 0;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .panes {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    section {
      min-width: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--tk-border);
    }
    section:last-child {
      border-right: 0;
    }
    .label {
      height: 28px;
      flex: none;
      display: flex;
      align-items: center;
      padding: 0 16px;
      border-bottom: 1px solid var(--tk-border-subtle);
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
    }
    pre {
      flex: 1;
      margin: 0;
      padding: 8px 0 32px;
      overflow: auto;
      font-family: var(--tk-font-mono);
      font-size: 12.5px;
      line-height: 20px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .rendered {
      flex: 1;
      min-height: 0;
      position: relative;
      background: var(--tk-bg-subtle);
    }
    .ln {
      display: block;
      padding: 0 16px 0 52px;
      text-indent: -40px;
    }
    .ln i {
      display: inline-block;
      width: 32px;
      margin-right: 8px;
      color: var(--tk-text-disabled);
      font-style: normal;
      text-align: right;
      text-indent: 0;
    }
    .ln.clash {
      background: var(--tk-warning-bg);
      box-shadow: inset 2px 0 var(--tk-warning-fg);
    }
  `,
})
export class DocConflictComponent {
  readonly conflict = input.required<EditConflict>();
  readonly busy = input(false);
  /// False for formats without a text merge (Canvas): no "Keep editing on latest", and the panes
  /// show the projected `[theirs]` and `[mine]` renderings instead of numbered lines.
  readonly textual = input(true);

  readonly keep = output();
  readonly overwrite = output();
  readonly discard = output();

  protected readonly theirs = computed(() =>
    numbered(
      this.conflict().theirs.content ?? '',
      this.conflict().regions.map((r) => r.theirs),
    ),
  );
  protected readonly mine = computed(() =>
    numbered(
      this.conflict().mine.content,
      this.conflict().regions.map((r) => r.mine),
    ),
  );
}

function numbered(text: string, ranges: readonly LineRange[]): ConflictLine[] {
  return text.split('\n').map((line, index) => ({
    number: index + 1,
    text: line,
    clash: ranges.some(
      (r) => index >= r.start && (index < r.end || (r.start === r.end && index === r.start)),
    ),
  }));
}
