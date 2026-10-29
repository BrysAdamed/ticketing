import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { tablerShare } from '@ng-icons/tabler-icons';
import { tierColor, tierName } from '@shared/ui/achievement-medal/achievement-medal.logic';
import { AchievementMedalComponent } from '@shared/ui/achievement-medal/achievement-medal.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AchievementTile } from './achievements.logic';

interface LadderRow {
  tier: number;
  name: string;
  threshold: number;
  color: string;
  pips: number[];
  earned: boolean;
  next: boolean;
}

/// The medal detail popover (mockup "Medal detail"): description, the tier ladder of an earned
/// tiered medal, the "How to earn" hint of a locked one; no hint for a masked secret.
@Component({
  selector: 'tk-achievement-detail',
  imports: [A11yModule, AchievementMedalComponent, IconComponent],
  viewProviders: [provideIcons({ tablerShare })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="tk-popover detail"
      role="dialog"
      [attr.aria-labelledby]="headingId()"
      data-testid="achievement-detail"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
    >
      <header>
        <tk-achievement-medal
          [achievementId]="item().id"
          [icon]="item().icon"
          [tier]="item().tier"
          [tierCount]="tile().tierCount"
          [shared]="item().shared"
          [size]="64"
        />
        <div class="title">
          <h3 [id]="headingId()">{{ item().name ?? '???' }}</h3>
          <div class="tier">
            {{ item().masked ? 'Secret · not earned yet' : tile().tierText }}
          </div>
        </div>
        <button
          type="button"
          class="tk-icon-btn close"
          aria-label="Close"
          data-testid="achievement-detail-close"
          (click)="closed.emit()"
        >
          <tk-icon name="tablerX" [size]="14" />
        </button>
      </header>
      <div class="body">
        @if (item().masked) {
          <p>A secret achievement. It turns up when you least expect it, so there is no hint.</p>
        } @else {
          <p>{{ item().description }}</p>
          @if (item().tier === 0 && item().howToEarn; as howToEarn) {
            <div class="label">How to earn</div>
            <div class="howto" data-testid="achievement-how-to-earn">
              <tk-icon name="tablerInfoCircle" [size]="14" />
              <span>{{ howToEarn }}</span>
            </div>
          }
          @if (ladder().length > 0) {
            <div class="label">Tiers</div>
            <ul class="ladder" aria-label="Tiers">
              @for (row of ladder(); track row.tier) {
                <li [class.done]="row.earned" [class.next]="row.next">
                  <span class="pips" aria-hidden="true">
                    @for (pip of row.pips; track $index) {
                      <i [style.background]="row.color"></i>
                    }
                  </span>
                  {{ row.name }}
                  <span class="n tnum">{{ row.threshold }}</span>
                  <span class="end">
                    @if (row.earned) {
                      <tk-icon name="tablerCheck" [size]="14" />Earned
                    } @else if (row.next) {
                      <span class="tnum">{{ count() }} so far</span>
                    }
                  </span>
                </li>
              }
            </ul>
          }
        }
      </div>
      @if (item().tier > 0 && !item().masked) {
        <div class="share-row" data-testid="achievement-detail-share">
          <span class="note">{{
            item().shared
              ? 'Shared. Everyone signed in sees the name and tier, never when you earned it.'
              : 'Not shared. Sharing shows everyone signed in the name and tier, never when you earned it.'
          }}</span>
          <button
            type="button"
            class="share"
            data-testid="achievement-detail-share-toggle"
            [class.on]="item().shared"
            (click)="shareToggled.emit()"
          >
            @if (item().shared) {
              <tk-icon name="tablerX" [size]="14" />Unshare
            } @else {
              <tk-icon name="tablerShare" [size]="14" />Share
            }
          </button>
        </div>
      }
      <!-- TODO TKT-93: the "Show me" learn action goes in a footer here for locked, non-secret entries when one can start (D-143). -->
    </div>
  `,
  styles: `
    .detail {
      width: 340px;
    }
    header {
      display: flex;
      gap: 14px;
      align-items: center;
      padding: 16px 12px 8px 16px;
    }
    .title {
      flex: 1;
      min-width: 0;
    }
    h3 {
      margin: 0;
      font-size: var(--tk-text-lg);
      line-height: var(--tk-leading-lg);
      font-weight: var(--tk-weight-semibold);
    }
    .tier {
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    .close {
      align-self: flex-start;
    }
    .body {
      padding: 0 16px 12px;
      color: var(--tk-text-muted);
    }
    p {
      margin: 0 0 10px;
    }
    .label {
      margin: 4px 0;
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
      color: var(--tk-text-subtle);
    }
    .howto {
      display: flex;
      gap: 8px;
      padding: 8px 10px;
      margin-bottom: 10px;
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-subtle);
      color: var(--tk-text);
    }
    .howto tk-icon {
      color: var(--tk-text-subtle);
      margin-top: 3px;
    }
    .ladder {
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
    }
    .ladder li {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 28px;
      border-bottom: 1px solid var(--tk-border-subtle);
      color: var(--tk-text-muted);
    }
    .ladder li:last-child {
      border-bottom: 0;
    }
    .ladder li.done,
    .ladder li.next {
      color: var(--tk-text);
    }
    .pips {
      display: inline-flex;
      gap: 3px;
      width: 33px;
    }
    .pips i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .n {
      color: var(--tk-text-muted);
    }
    .end {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-subtle);
    }
    li.done .end {
      color: var(--tk-success-fg);
    }
    .share-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 12px 16px;
      border-top: 1px solid var(--tk-border-subtle);
    }
    .note {
      flex: 1;
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
      color: var(--tk-text-subtle);
    }
    .share {
      height: 28px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: none;
      padding: 0 8px;
      border: 1px solid var(--tk-border-strong);
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
      cursor: pointer;
    }
    .share:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    .share.on {
      border-color: transparent;
      background: var(--tk-accent-subtle);
      color: var(--tk-accent-fg);
    }
    .share.on:hover {
      background: var(--tk-accent-subtle-hover);
    }
    .share:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: 1px;
    }
  `,
})
export class AchievementDetailComponent {
  readonly tile = input.required<AchievementTile>();
  readonly closed = output<void>();
  readonly shareToggled = output<void>();

  protected readonly item = computed(() => this.tile().item);
  protected readonly headingId = computed(() => `achievement-detail-${this.tile().key}`);
  protected readonly count = computed(() => this.item().progress?.count ?? 0);
  protected readonly ladder = computed<LadderRow[]>(() => {
    const { item, tierCount } = this.tile();
    if (item.masked || tierCount <= 1 || item.tier === 0) return [];
    const nextTier = item.progress?.nextTier ?? null;
    return item.tiers.map((t) => ({
      tier: t.tier,
      name: tierName(t.tier),
      threshold: t.threshold,
      color: tierColor(t.tier),
      pips: Array.from({ length: t.tier }, (_, i) => i),
      earned: t.tier <= item.tier,
      next: t.tier === nextTier,
    }));
  });
}
