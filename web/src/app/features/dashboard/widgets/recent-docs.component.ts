import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerChalkboard, tablerSitemap } from '@ng-icons/tabler-icons';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { RecentDocRow } from '../dashboard-widgets';

/// Widget 13 (spec §7): the project's latest pages and diagrams as compact rows (kind icon, title,
/// folder, last editor, time); a row opens the doc.
@Component({
  selector: 'tk-recent-docs',
  imports: [RouterLink, AvatarComponent, IconComponent, RelativeTimePipe],
  viewProviders: [provideIcons({ tablerChalkboard, tablerSitemap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul aria-label="Recently updated docs">
      @for (doc of docs(); track doc.key) {
        <li>
          <a class="row" [routerLink]="doc.url" [attr.data-testid]="'dashboard-doc-' + doc.key">
            <tk-icon class="icon" [name]="doc.icon" [size]="16" />
            <span class="title" [title]="doc.title">{{ doc.title }}</span>
            <span class="folder">{{ doc.folder }}</span>
            <tk-avatar [userId]="doc.editor.id" [name]="doc.editor.name" />
            <span class="when" [title]="doc.updatedAt">{{ doc.updatedAt | relativeTime }}</span>
          </a>
        </li>
      }
    </ul>
  `,
  styles: `
    ul {
      list-style: none;
      margin: 0 -8px;
      padding: 0;
    }
    .row {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border-radius: var(--tk-radius-sm);
      color: var(--tk-text);
      text-decoration: none;
    }
    .row:hover {
      background: var(--tk-bg-hover);
    }
    .row:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: -2px;
    }
    .icon {
      flex: none;
      color: var(--tk-text-subtle);
    }
    .title {
      max-width: 55%;
      flex: none;
      font-weight: var(--tk-weight-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .folder {
      flex: 1;
      min-width: 0;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .when {
      width: 72px;
      flex: none;
      text-align: right;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class RecentDocsComponent {
  readonly docs = input.required<readonly RecentDocRow[]>();
}
