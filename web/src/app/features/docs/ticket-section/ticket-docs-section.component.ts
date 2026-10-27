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
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  tablerChalkboard,
  tablerFileText,
  tablerFolder,
  tablerPlus,
  tablerSitemap,
} from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { docLocation, docUrl, mentionFragment } from '@core/docs/doc-links';
import { DocMentionsApi, TICKET_DOCS_LIMIT } from '@core/docs/doc-mentions.api';
import { docKindIcon } from '@core/docs/doc-search.api';
import { DOC_ROOT, DOC_TREE_LIMITS, DocMentions } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { TicketCache } from '@core/tickets/ticket-cache';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';

const TITLE_TAKEN = 'doc.title.duplicate';
const MAX_TITLE_ATTEMPTS = 5;

/// "Docs mentioning this ticket" in the ticket view (spec 1.9, registered through
/// `provideTicketDetailSection`): readable docs whose latest content names the ticket, newest
/// first, at most 20 and then "and N more" linking to docs search. Hidden while empty. A row opens the
/// doc at its first mention (`#mention-KEY`); writers get "Write doc" (D-114).
@Component({
  selector: 'tk-ticket-docs-section',
  imports: [RouterLink, MatButtonModule, IconComponent, RelativeTimePipe, AbsoluteTimePipe],
  viewProviders: [
    provideIcons({ tablerChalkboard, tablerFileText, tablerFolder, tablerPlus, tablerSitemap }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'ticket-docs', '[class.empty]': '!mentions().total' },
  template: `
    @if (mentions().total) {
      <div class="sec-h">
        <h2>Docs mentioning this ticket</h2>
        <span class="n tnum" data-testid="ticket-docs-count">{{ mentions().total }}</span>
        @if (canWrite()) {
          <button
            mat-button
            type="button"
            class="write"
            data-testid="ticket-docs-write"
            [disabled]="creating()"
            (click)="writeDoc()"
          >
            <tk-icon name="tablerPlus" [size]="14" />Write doc
          </button>
        }
      </div>
      <div class="box" role="list">
        @for (doc of mentions().items; track doc.id) {
          <a
            class="lrow"
            role="listitem"
            [routerLink]="link(doc.key, doc.title)"
            [fragment]="mention()"
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
    .write {
      margin-left: auto;
    }
    .write tk-icon {
      margin-right: 4px;
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
  private readonly docs = inject(DocsApi);
  private readonly tickets = inject(TicketCache);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly ticketKey = input.required<string>();
  readonly projectKey = input.required<string>();

  protected readonly mentions = signal<DocMentions>({ total: 0, items: [] });
  protected readonly more = computed(() => this.mentions().total - this.mentions().items.length);
  protected readonly icon = docKindIcon;
  protected readonly canWrite = signal(false);
  protected readonly creating = signal(false);
  protected readonly mention = computed(() => mentionFragment(this.ticketKey()));

  constructor() {
    effect(() => {
      const key = this.ticketKey();
      untracked(() => void this.load(key));
    });
  }

  protected link(key: string, title: string): string {
    return docUrl(key, title);
  }

  protected folderOf(projectKey: string, path: string): string {
    return docLocation(path, projectKey, this.projectKey());
  }

  /// Creates a page at the top level of the ticket's project, prefilled with "Related: KEY", and
  /// opens its editor. A title already taken there gets " (2)", " (3)", ….
  protected async writeDoc(): Promise<void> {
    const ticketKey = this.ticketKey();
    this.creating.set(true);
    try {
      const ticket = await this.tickets.fetch(ticketKey);
      const base = `${ticket.key} ${ticket.title}`.slice(0, DOC_TREE_LIMITS.titleMaxLength - 4);
      for (let attempt = 1; ; attempt++) {
        const title = attempt === 1 ? base : `${base} (${attempt})`;
        try {
          const doc = await firstValueFrom(
            this.docs.create(ticket.projectKey, {
              kind: 'Page',
              title,
              parent: DOC_ROOT,
              content: `Related: ${ticket.key}\n`,
            }),
          );
          await this.router.navigateByUrl(`${docUrl(doc.key, doc.title)}?mode=edit`);
          return;
        } catch (error) {
          if (attempt >= MAX_TITLE_ATTEMPTS || toApiError(error).code !== TITLE_TAKEN) throw error;
        }
      }
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.creating.set(false);
    }
  }

  private async load(ticketKey: string): Promise<void> {
    this.mentions.set({ total: 0, items: [] });
    const [mentions, ticket] = await Promise.allSettled([
      firstValueFrom(this.api.forTicket(ticketKey, TICKET_DOCS_LIMIT)),
      this.tickets.fetch(ticketKey),
    ]);
    if (ticketKey !== this.ticketKey()) return;
    if (mentions.status === 'fulfilled') this.mentions.set(mentions.value);
    this.canWrite.set(ticket.status === 'fulfilled' && ticket.value.permissions.canEdit);
  }
}
