import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  tablerChalkboard,
  tablerFileText,
  tablerFolder,
  tablerSitemap,
} from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { docPathSegments, docUrl } from '@core/docs/doc-links';
import { DocMentionsApi, TICKET_DOCS_LIMIT } from '@core/docs/doc-mentions.api';
import { docKindIcon } from '@core/docs/doc-search.api';
import { DocMentions } from '@core/docs/doc.models';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// "Docs mentioning this ticket" in the ticket view (spec 1.9, registered through
/// `provideTicketDetailSection`): readable docs whose latest content names the ticket, newest
/// first, at most 20 and then "and N more" linking to docs search. Hidden while empty.
@Component({
  selector: 'tk-ticket-docs-section',
  imports: [RouterLink, IconComponent, RelativeTimePipe, AbsoluteTimePipe],
  viewProviders: [provideIcons({ tablerChalkboard, tablerFileText, tablerFolder, tablerSitemap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'ticket-docs', '[class.empty]': '!mentions().total' },
  template: `
    @if (mentions().total) {
      <div class="sec-h">
        <h2>Docs mentioning this ticket</h2>
        <span class="n tnum" data-testid="ticket-docs-count">{{ mentions().total }}</span>
      </div>
      <div class="box" role="list">
        @for (doc of mentions().items; track doc.id) {
          <a
            class="lrow"
            role="listitem"
            [routerLink]="link(doc.key, doc.title)"
            [attr.data-testid]="'ticket-doc-' + doc.key"
          >
            <tk-icon [name]="icon(doc.kind, doc.diagramFormat)" [size]="14" />
            <span class="t">{{ doc.title }}</span>
            <span class="p" [title]="doc.path">{{ folderOf(doc.projectKey, doc.path) }}</span>
            <span class="who" [title]="doc.updatedAt | absoluteTime"
              >{{ doc.updatedBy.displayName }} · {{ doc.updatedAt | relativeTime }}</span
            >
          </a>
        }
        @if (more() > 0) {
          <a
            class="more"
            data-testid="ticket-docs-more"
            routerLink="/search"
            [queryParams]="{ scope: 'docs', mentions: ticketKey() }"
            >and {{ more() }} more</a
          >
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    :host(.empty) {
      display: none;
    }
    .sec-h {
      height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .sec-h h2 {
      margin: 0;
      font-size: var(--tk-text-md);
      font-weight: var(--tk-weight-semibold);
    }
    .sec-h .n {
      color: var(--tk-text-subtle);
      font-weight: var(--tk-weight-medium);
    }
    .box {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
      background: var(--tk-surface);
    }
    .lrow {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-bottom: 1px solid var(--tk-border-subtle);
      color: var(--tk-text);
      text-decoration: none;
    }
    .lrow:hover {
      background: var(--tk-bg-hover);
    }
    .lrow tk-icon {
      flex: none;
      color: var(--tk-text-subtle);
    }
    .t {
      flex: 0 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .p {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .who {
      flex: none;
      margin-left: auto;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      font-variant-numeric: tabular-nums;
    }
    .box > :last-child {
      border-bottom: 0;
    }
    .more {
      display: block;
      padding: 7px 12px;
      color: var(--tk-accent-fg);
      font-size: var(--tk-text-sm);
      text-decoration: none;
    }
    .more:hover {
      text-decoration: underline;
    }
  `,
})
export class TicketDocsSectionComponent {
  private readonly api = inject(DocMentionsApi);

  readonly ticketKey = input.required<string>();
  readonly projectKey = input.required<string>();

  protected readonly mentions = signal<DocMentions>({ total: 0, items: [] });
  protected readonly more = computed(() => this.mentions().total - this.mentions().items.length);
  protected readonly icon = docKindIcon;

  constructor() {
    effect(() => {
      const key = this.ticketKey();
      untracked(() => void this.load(key));
    });
  }

  protected link(key: string, title: string): string {
    return docUrl(key, title);
  }

  /// The folder path, with the project key when the doc lives in another project.
  protected folderOf(projectKey: string, path: string): string {
    const folder = docPathSegments(path).slice(0, -1).join(' / ');
    return projectKey === this.projectKey()
      ? folder
      : [projectKey, folder].filter(Boolean).join(' · ');
  }

  private async load(ticketKey: string): Promise<void> {
    this.mentions.set({ total: 0, items: [] });
    try {
      const mentions = await firstValueFrom(this.api.forTicket(ticketKey, TICKET_DOCS_LIMIT));
      if (ticketKey === this.ticketKey()) this.mentions.set(mentions);
    } catch {
      return;
    }
  }
}
