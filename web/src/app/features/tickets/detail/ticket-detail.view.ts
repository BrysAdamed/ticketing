import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Breadcrumbs } from '@core/layout/breadcrumbs';
import { PageTitleStrategy } from '@core/layout/page-title';
import { MoveTarget } from '@core/tickets/move-targets';
import { TicketEvents } from '@core/tickets/ticket-events';
import { PeekService } from '@core/layout/peek/peek';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { Shortcut, ShortcutService } from '@core/shortcuts/shortcut.service';
import { TicketAttachments } from '@core/tickets/ticket-attachments';
import { TICKET_DETAIL_SECTIONS } from '@core/tickets/ticket-sections';
import { TicketLink, TicketRef } from '@core/tickets/ticket.models';
import { TICKET_TYPE_LABELS } from '@shared/domain/enums';
import { AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { TestCaseStatusBadgeComponent } from '@shared/ui/domain/domain-badges';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { TICKET_ICONS } from '../ticket-icons';
import { ActivityTab, TicketActivityComponent } from './ticket-activity.component';
import { NewChild, TicketChildrenComponent } from './ticket-children.component';
import { FieldEdit, TicketFieldsComponent } from './ticket-fields.component';
import { NewLink, TicketLinksComponent } from './ticket-links.component';
import { TicketSectionsHostComponent } from './ticket-sections-host.component';
import { TicketDetailStore } from './ticket-detail.store';
import { TicketDescriptionComponent, TicketTitleComponent } from './ticket-text.component';
import { TicketWatchComponent } from './ticket-watch.component';

export type TicketPresentation = 'page' | 'peek';

/// One ticket view hosted two ways (layout-and-screens §2): the routed full page /tickets/:key
/// (two columns, ticket-detail.html) and the peek panel (single column, fields as a grid).
@Component({
  selector: 'tk-ticket-detail-view',
  imports: [
    MatButtonModule,
    MatMenuModule,
    MatTooltip,
    RouterLink,
    AbsoluteTimePipe,
    TestCaseStatusBadgeComponent,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    SkeletonRowsComponent,
    TicketActivityComponent,
    TicketChildrenComponent,
    TicketFieldsComponent,
    TicketLinksComponent,
    TicketSectionsHostComponent,
    TicketTitleComponent,
    TicketDescriptionComponent,
    TicketWatchComponent,
  ],
  providers: [TicketDetailStore],
  viewProviders: [provideIcons(TICKET_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tk-page',
    'data-testid': 'view-ticket.detail',
    '[attr.data-presentation]': 'presentation()',
    '[attr.data-ticket-key]': 'store.key()',
  },
  templateUrl: './ticket-detail.view.html',
  styleUrl: './ticket-detail.view.scss',
})
export class TicketDetailView {
  protected readonly store = inject(TicketDetailStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly clipboard = inject(Clipboard);
  private readonly router = inject(Router);
  private readonly peek = inject(PeekService);
  private readonly document = inject(DOCUMENT);
  private readonly breadcrumbs = inject(Breadcrumbs);
  private readonly pageTitle = inject(PageTitleStrategy);
  private readonly events = inject(TicketEvents);

  readonly ticketKey = input.required<string>();
  protected readonly uploadHandler = inject(TicketAttachments).markdownUploader(() =>
    this.ticketKey(),
  );
  readonly presentation = input<TicketPresentation>('page');

  protected readonly typeLabels = TICKET_TYPE_LABELS;
  protected readonly hasTestCaseSection = inject(TICKET_DETAIL_SECTIONS).some(
    (s) => s.id === 'test-cases',
  );
  protected readonly notFoundTitle = computed(() => {
    const error = this.store.error();
    if (!error) return '';
    return error.code === 'ticket.deleted'
      ? error.title
      : `${this.ticketKey().toUpperCase()} doesn't exist or you don't have access`;
  });
  protected readonly saveTitle = (title: string) => this.saveText({ title }, { title });
  protected readonly saveDescription = (description: string) =>
    this.saveText(
      { description: description.trim() || null },
      { description: description.trim() || null },
    );
  protected readonly addComment = (body: string) => this.store.addComment(body);

  private readonly title = viewChild(TicketTitleComponent);
  private readonly description = viewChild(TicketDescriptionComponent);
  private readonly fields = viewChild(TicketFieldsComponent);

  constructor() {
    effect(() => {
      const key = this.ticketKey();
      untracked(() => void this.store.load(key));
    });

    effect(() => {
      const ticket = this.store.ticket();
      if (this.presentation() !== 'page' || !ticket) return;
      const parent = ticket.parent;
      untracked(() =>
        this.breadcrumbs.setTail([
          ...(parent
            ? [{ label: `${parent.key} ${parent.title}`, url: `/tickets/${parent.key}` }]
            : []),
          { label: ticket.key, url: null },
        ]),
      );
    });

    effect(() => {
      const id = this.store.ticket()?.id;
      if (id && this.store.historyStatus() === 'idle')
        untracked(() => void this.store.loadHistory());
    });

    effect(() => {
      const ticket = this.store.ticket();
      if (this.presentation() !== 'page' || !ticket) return;
      untracked(() => this.pageTitle.setSubject(`${ticket.key} ${ticket.title}`));
    });

    this.events.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event.kind !== 'deleted' || event.key.toUpperCase() !== this.store.key()) return;
      const projectKey = this.store.ticket()?.projectKey ?? event.key.split('-')[0];
      if (this.presentation() === 'peek') this.peek.close();
      else void this.router.navigate(['/projects', projectKey, 'backlog']);
    });

    const shortcuts: Shortcut[] = [
      {
        keys: 'e',
        section: 'Ticket',
        description: 'Edit title',
        handler: () => this.title()?.start(),
      },
      {
        keys: 'shift+e',
        section: 'Ticket',
        description: 'Edit description',
        handler: () => this.description()?.start(),
      },
      {
        keys: 's',
        section: 'Ticket',
        description: 'Change status',
        handler: () => this.fields()?.openPicker('status'),
      },
      {
        keys: 'p',
        section: 'Ticket',
        description: 'Change priority',
        handler: () => this.fields()?.openPicker('priority'),
      },
      {
        keys: 't',
        section: 'Ticket',
        description: 'Change type',
        handler: () => this.fields()?.openPicker('type'),
      },
      {
        keys: 'a',
        section: 'Ticket',
        description: 'Assign to…',
        handler: () => this.fields()?.openPicker('assignee'),
      },
      {
        keys: 'i',
        section: 'Ticket',
        description: 'Assign to me',
        handler: () => this.assignToMe(),
      },
      {
        keys: 'w',
        section: 'Ticket',
        description: 'Watch / unwatch',
        handler: () => void this.store.toggleWatch(),
      },
      {
        keys: 'l',
        section: 'Ticket',
        description: 'Change labels',
        handler: () => this.fields()?.openPicker('labels'),
      },
      {
        keys: 'm',
        section: 'Ticket',
        description: 'Move to…',
        handler: () => this.fields()?.openPicker('location'),
      },
      {
        keys: 'delete',
        section: 'Ticket',
        description: 'Delete ticket',
        handler: () => void this.deleteTicket(),
      },
      {
        keys: 'mod+backspace',
        section: 'Ticket',
        description: 'Delete ticket',
        handler: () => void this.deleteTicket(),
        showInHelp: false,
      },
      { keys: 'mod+.', section: 'Ticket', description: 'Copy key', handler: () => this.copyKey() },
      {
        keys: 'mod+shift+.',
        section: 'Ticket',
        description: 'Copy link',
        handler: () => this.copyLink(),
      },
    ];
    const shortcutService = inject(ShortcutService);
    effect((onCleanup) => {
      if (this.presentation() === 'page' && this.peek.isOpen()) return;
      const removers = untracked(() => shortcuts.map((s) => shortcutService.register(s)));
      onCleanup(() => removers.forEach((remove) => remove()));
    });
  }

  protected onFieldChange(edit: FieldEdit): void {
    void this.store.patch(edit.patch, edit.optimistic);
  }

  protected assignToMe(): void {
    if (this.store.canEdit()) void this.store.assignToMe();
  }

  protected onActivityTab(tab: ActivityTab): void {
    if (tab !== 'comments' && this.store.historyStatus() === 'idle') void this.store.loadHistory();
  }

  protected onChildCreated(child: NewChild): void {
    void this.store.createChild(child.title, child.type);
  }

  protected onChildAdopted(child: TicketRef): void {
    void this.store.adoptChild(child);
  }

  protected onLinkAdded(link: NewLink & { fromKey: string }): void {
    void this.store.addLink(link.fromKey, link.targetKey, link.type);
  }

  protected onLinkRemoved(link: TicketLink): void {
    void this.store.removeLink(link.id);
  }

  protected copyKey(): void {
    const key = this.store.ticket()?.key;
    if (key && this.clipboard.copy(key)) this.toast.success(`Copied ${key}`);
  }

  protected copyLink(): void {
    const key = this.store.ticket()?.key;
    if (!key) return;
    const origin = this.document.defaultView?.location.origin ?? '';
    if (this.clipboard.copy(`${origin}/tickets/${key}`)) this.toast.success('Link copied');
  }

  /// Immediate delete with an Undo toast (D-82); the view closes on the `deleted` event.
  protected async deleteTicket(): Promise<void> {
    if (this.store.ticket()?.permissions.canDelete) await this.store.delete();
  }

  protected onMoved(target: MoveTarget): void {
    void this.store.moveTo(target);
  }

  /// Title and description saves carry If-Match; a conflict offers to reload and keeps the editor open.
  private async saveText(
    patch: { title?: string; description?: string | null },
    optimistic: { title?: string; description?: string | null },
  ): Promise<boolean> {
    const result = await this.store.patch(patch, optimistic, { ifMatch: true });
    if (result === 'saved') return true;
    if (result === 'conflict') {
      const reload = await this.confirm.confirm({
        title: 'Someone else changed this ticket',
        message:
          'Reload the latest version? Your text stays in the editor so you can save it again.',
        confirmLabel: 'Reload',
      });
      if (reload) await this.store.reload();
    }
    return false;
  }
}
