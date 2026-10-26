import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AvatarComponent, AvatarSize } from './avatar.component';

export interface UserRef {
  id: string;
  displayName: string;
  email?: string;
  isActive?: boolean;
}

/// Avatar + display name; deactivated users render as "Name (deactivated)" (spec 4.1).
@Component({
  selector: 'tk-user',
  imports: [AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <tk-avatar
      [userId]="user()?.id"
      [name]="user()?.displayName"
      [size]="size()"
      [showTitle]="false"
    />
    <span class="name" [class.unassigned]="!user()">
      @if (user(); as u) {
        {{ u.displayName }}
        @if (u.isActive === false) {
          <span class="deactivated">(deactivated)</span>
        }
      } @else {
        {{ emptyLabel() }}
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .unassigned,
    .deactivated {
      color: var(--tk-text-subtle);
      font-weight: var(--tk-weight-regular);
    }
  `,
})
export class UserDisplayComponent {
  readonly user = input<UserRef | null | undefined>(null);
  readonly size = input<AvatarSize>(20);
  readonly emptyLabel = input('Unassigned');
}
