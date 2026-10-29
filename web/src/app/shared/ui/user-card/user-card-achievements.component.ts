import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AchievementMedalComponent } from '../achievement-medal/achievement-medal.component';
import { UserCardSection } from './user-card.logic';

/// The user card's achievements list (32px medals with name and tier). Loaded through `@defer`,
/// so the medal and its glyphs stay out of the pages that show a card.
@Component({
  selector: 'tk-user-card-achievements',
  imports: [AchievementMedalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="label" [id]="headingId()">{{ section().heading }}</h3>
    <ul class="list" [attr.aria-labelledby]="headingId()" data-testid="user-card-achievements">
      @for (medal of section().items; track medal.id) {
        <li
          class="item"
          [attr.aria-label]="medal.label"
          [attr.data-testid]="'user-card-achievement-' + medal.id"
        >
          <tk-achievement-medal
            [achievementId]="medal.id"
            [icon]="medal.icon"
            [tier]="medal.tier"
            [tierCount]="medal.tierCount"
            [size]="32"
          />
          <div aria-hidden="true">
            <div class="n">{{ medal.name }}</div>
            <div class="tr">{{ medal.tierText }}</div>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: block;
      padding: 10px 14px 12px;
      border-top: 1px solid var(--tk-border-subtle);
    }
    .label {
      margin: 0 0 6px;
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
      color: var(--tk-text-subtle);
    }
    .list {
      display: grid;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 40px;
      padding: 0 6px;
      margin: 0 -6px;
      border-radius: var(--tk-radius-md);
    }
    .item:hover {
      background: var(--tk-bg-hover);
    }
    .n {
      font-weight: var(--tk-weight-medium);
      line-height: 16px;
    }
    .tr {
      font-size: var(--tk-text-xs);
      color: var(--tk-text-muted);
    }
  `,
})
export class UserCardAchievementsComponent {
  readonly section = input.required<UserCardSection>();
  readonly headingId = input.required<string>();
}
