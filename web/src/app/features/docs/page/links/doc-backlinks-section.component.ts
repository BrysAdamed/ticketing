import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  tablerChalkboard,
  tablerFileText,
  tablerFolder,
  tablerSitemap,
} from '@ng-icons/tabler-icons';
import { docKindIcon } from '@core/docs/doc-search.api';
import { docLocation, docUrl } from '@core/docs/doc-links';
import { Doc } from '@core/docs/doc.models';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// "Linked from" (spec 1.9): readable, non-deleted docs whose latest content links here, newest
/// first, from the doc's `backlinks` (no extra request). Hidden when empty.
@Component({
  selector: 'tk-doc-backlinks-section',
  imports: [RouterLink, IconComponent, RelativeTimePipe, AbsoluteTimePipe],
  viewProviders: [provideIcons({ tablerChalkboard, tablerFileText, tablerFolder, tablerSitemap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'doc-backlinks', '[class.tk-section-empty]': '!backlinks().total' },
  template: `
    @if (backlinks().total) {
      <div class="sec-h">
        <h2>Linked from</h2>
        <span class="n tnum">{{ backlinks().total }}</span>
      </div>
      <div class="box" role="list">
        @for (item of backlinks().items; track item.id) {
          <a
            class="lrow"
            role="listitem"
            [routerLink]="link(item.key, item.title)"
            [attr.data-testid]="'doc-backlink-' + item.key"
          >
            <tk-icon [name]="icon(item.kind, item.diagramFormat)" [size]="14" />
            <span class="t">{{ item.title }}</span>
            <span class="p" [title]="item.path">{{ location(item.path, item.projectKey) }}</span>
            <span class="when" [title]="item.updatedAt | absoluteTime">{{
              item.updatedAt | relativeTime
            }}</span>
          </a>
        }
        @if (backlinks().total > backlinks().items.length) {
          <span class="more">and {{ backlinks().total - backlinks().items.length }} more</span>
        }
      </div>
    }
  `,
  styleUrl: './doc-links-section.scss',
})
export class DocBacklinksSectionComponent {
  readonly doc = input.required<Doc>();

  protected readonly backlinks = computed(() => this.doc().backlinks);
  protected readonly icon = docKindIcon;

  protected link(key: string, title: string): string {
    return docUrl(key, title);
  }

  protected location(path: string, projectKey: string): string {
    return docLocation(path, projectKey, this.doc().projectKey);
  }
}
