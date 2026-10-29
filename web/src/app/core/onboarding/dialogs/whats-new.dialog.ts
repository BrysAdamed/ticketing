import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { FeatureFlagService } from '../../flags/feature-flag.service';
import { whatsNewMonthStart } from '../auto-dialogs.logic';
import { WhatsNewEntry } from '../guides/whats-new';

export interface WhatsNewDialogData {
  /// In display order: one due entry when it opens by itself, every entry newest first from Help.
  entries: readonly WhatsNewEntry[];
}

const MONTH = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/// What's new highlights (spec 14.2). Closes with true on Got it, undefined on Esc, × or the
/// backdrop; `OnboardingDialogs` records the entries as Completed or Dismissed.
@Component({
  selector: 'tk-whats-new-dialog',
  imports: [MatDialogModule, MatButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'whats-new-dialog' },
  template: `
    <button
      type="button"
      class="tk-icon-btn close"
      aria-label="Close"
      data-testid="whats-new-close"
      (click)="ref.close()"
    >
      <tk-icon name="tablerX" [size]="16" />
    </button>
    <div class="head">
      <div class="eyebrow"><tk-icon name="tablerSparkles" [size]="14" />What’s new</div>
      <h2 mat-dialog-title class="title">{{ entries()[0].title }}</h2>
    </div>
    <mat-dialog-content class="content">
      @for (entry of entries(); track entry.id; let first = $first) {
        <section class="entry" [attr.data-testid]="'whats-new-entry-' + entry.date">
          @if (first) {
            <p class="date">{{ entry.month }}</p>
          } @else {
            <h3 class="older">
              {{ entry.title }} <span class="date">{{ entry.month }}</span>
            </h3>
          }
          <ul>
            @for (item of entry.items; track item.title) {
              <li>
                <b>{{ item.title }}</b>
                <span>{{ item.body }}</span>
              </li>
            }
          </ul>
        </section>
      }
    </mat-dialog-content>
    <mat-dialog-actions class="foot">
      <span class="note">Reopen any time from Help</span>
      <button
        mat-flat-button
        type="button"
        cdkFocusInitial
        data-testid="whats-new-done"
        (click)="ref.close(true)"
      >
        Got it
      </button>
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
      padding: 22px 24px 0;
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
      margin: 0;
      font-size: var(--tk-text-xl);
      line-height: var(--tk-leading-xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
    }
    .title::before {
      display: none;
    }
    .content.content {
      padding: 0 24px 4px;
      max-height: 60vh;
    }
    .date {
      margin: 0 0 10px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-regular);
    }
    .older {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 16px 0 8px;
      padding-top: 12px;
      border-top: 1px solid var(--tk-border-subtle);
      font-size: var(--tk-text-base);
      font-weight: var(--tk-weight-semibold);
      color: var(--tk-text);
    }
    .older .date {
      margin: 0;
    }
    ul {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: grid;
      gap: 1px;
      padding: 8px 12px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      background: var(--tk-surface);
    }
    li b {
      font-weight: var(--tk-weight-semibold);
      color: var(--tk-text);
    }
    li span {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
    }
    .foot.foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 24px 20px;
    }
    .note {
      margin-right: auto;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class WhatsNewDialog {
  protected readonly ref = inject<MatDialogRef<WhatsNewDialog, boolean>>(MatDialogRef);
  private readonly data = inject<WhatsNewDialogData>(MAT_DIALOG_DATA);
  private readonly flags = inject(FeatureFlagService);

  /// Items behind a flag that is off for the user are left out.
  protected readonly entries = computed(() =>
    this.data.entries.map((entry) => ({
      ...entry,
      month: MONTH.format(whatsNewMonthStart(entry.date)),
      items: entry.items.filter((item) => !item.flag || this.flags.isOn(item.flag)),
    })),
  );
}
