import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvatarComponent } from '../domain/avatar.component';
import { UserRef } from '../domain/user-display.component';
import { UserCardAchievementsComponent } from './user-card-achievements.component';
import { SharedMedalsState, showManageLink, userCardSection } from './user-card.logic';

let nextId = 0;

/// A popover about a person (layout-and-screens §2 "User card"): avatar, name (never the email)
/// and, while there are any, their shared achievements. `self` reads "You" and links to Profile →
/// Achievements. Data comes from the caller; `tkUserCard` (core) opens it.
@Component({
  selector: 'tk-user-card',
  imports: [A11yModule, RouterLink, AvatarComponent, UserCardAchievementsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-popover' },
  template: `
    <div
      class="card"
      role="dialog"
      tabindex="-1"
      data-testid="user-card"
      [attr.data-achievements]="achievements().status"
      [attr.aria-labelledby]="nameId"
      [cdkTrapFocus]="trapFocus()"
    >
      <div class="head">
        <tk-avatar
          [userId]="user().id"
          [name]="user().displayName"
          [size]="32"
          [showTitle]="false"
        />
        <div class="who">
          <b [id]="nameId">{{ user().displayName }}</b>
          @if (self()) {
            <span>You</span>
          } @else if (user().isActive === false) {
            <span>Deactivated</span>
          }
        </div>
      </div>
      @if (section(); as section) {
        @defer {
          <tk-user-card-achievements [section]="section" [headingId]="nameId + '-shared'" />
        }
      }
      @if (manageLink()) {
        <div class="foot">
          <a
            routerLink="/profile/achievements"
            data-testid="user-card-manage"
            (click)="navigated.emit()"
            >Manage in Profile → Achievements</a
          >
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 300px;
    }
    .card:focus {
      outline: none;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 12px;
    }
    .who {
      min-width: 0;
    }
    .who b {
      display: block;
      overflow: hidden;
      font-weight: var(--tk-weight-semibold);
      line-height: 18px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .who span {
      display: block;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      line-height: 16px;
    }
    .foot {
      padding: 8px 14px 10px;
      border-top: 1px solid var(--tk-border-subtle);
      font-size: var(--tk-text-sm);
    }
    .foot a {
      color: var(--tk-accent-fg);
      font-weight: var(--tk-weight-medium);
      text-decoration: none;
    }
    .foot a:hover {
      text-decoration: underline;
    }
  `,
})
export class UserCardComponent {
  readonly user = input.required<UserRef>();
  readonly self = input(false);
  readonly achievements = input<SharedMedalsState>({ status: 'off' });
  /// Keep Tab inside while the card was opened by click or Enter.
  readonly trapFocus = input(false);
  readonly navigated = output<void>();

  protected readonly nameId = `tk-user-card-${nextId++}`;
  protected readonly section = computed(() => userCardSection(this.achievements(), this.self()));
  protected readonly manageLink = computed(() => showManageLink(this.achievements(), this.self()));
}
