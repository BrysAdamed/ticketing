import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { ConfirmService } from '@core/notify/confirm.service';
import { ActivityEntry, Comment, UserRef } from '@core/tickets/ticket.models';
import {
  MarkdownEditorComponent,
  MarkdownUploadHandler,
} from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { MentionSearch } from '@shared/markdown/mentions';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SegmentedControlComponent } from '@shared/ui/segmented/segmented-control.component';
import { ActivityGroup, describeEntry, groupEntries } from './activity-format';

export type ActivityTab = 'all' | 'comments' | 'history';

type FeedItem =
  | { kind: 'comment'; at: string; comment: Comment }
  | { kind: 'history'; at: string; group: ActivityGroup };

/// Activity (layout-and-screens §3.3): tabs All · Comments · History, comment cards with edit/delete
/// for your own, history lines grouped per operation, and the composer (Ctrl/⌘+Enter).
@Component({
  selector: 'tk-ticket-activity',
  imports: [
    MatButtonModule,
    RouterLink,
    MarkdownEditorComponent,
    MarkdownViewerComponent,
    AbsoluteTimePipe,
    RelativeTimePipe,
    AvatarComponent,
    IconComponent,
    SegmentedControlComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sec', 'data-testid': 'ticket-activity' },
  template: `
    <div class="sec-h">
      <h2>Activity</h2>
      <span class="right">
        <tk-segmented
          ariaLabel="Activity filter"
          testId="activity-tab"
          [options]="tabOptions()"
          [value]="tab()"
          (valueChange)="setTab($event)"
        />
      </span>
    </div>

    @if (tab() !== 'comments' && hasMoreHistory()) {
      <button type="button" class="older" (click)="loadMoreHistory.emit()">
        Show older activity
      </button>
    }
    @if (tab() !== 'history' && commentCount() > comments().length) {
      <button type="button" class="older" (click)="loadAllComments.emit()">
        Show all {{ commentCount() }} comments
      </button>
    }

    <div class="feed" data-testid="activity-feed">
      @for (item of feed(); track $index) {
        @if (item.kind === 'comment') {
          @let c = item.comment;
          <article class="cmt" [class.deleted]="c.deleted" [attr.data-testid]="'comment-' + c.id">
            <div class="cmt-h">
              <tk-avatar [userId]="c.author.id" [name]="c.author.displayName" [size]="24" />
              <b>{{ c.author.displayName }}</b>
              @if (!c.author.isActive) {
                <span class="subtle">(deactivated)</span>
              }
              <span class="when" [title]="c.createdAt | absoluteTime">{{
                c.createdAt | relativeTime
              }}</span>
              @if (c.editedAt && !c.deleted) {
                <span class="when" [title]="c.editedAt | absoluteTime">· edited</span>
              }
              <span class="right">
                @if (c.canEdit && editingId() !== c.id) {
                  <button
                    type="button"
                    class="tk-icon-btn tk-icon-btn-sm"
                    aria-label="Edit comment"
                    data-testid="comment-edit"
                    (click)="startEdit(c)"
                  >
                    <tk-icon name="tablerPencil" [size]="14" />
                  </button>
                }
                @if (c.canDelete) {
                  <button
                    type="button"
                    class="tk-icon-btn tk-icon-btn-sm"
                    aria-label="Delete comment"
                    data-testid="comment-delete"
                    (click)="remove(c)"
                  >
                    <tk-icon name="tablerTrash" [size]="14" />
                  </button>
                }
              </span>
            </div>
            @if (c.deleted) {
              <div class="cmt-b subtle">Comment deleted</div>
            } @else if (editingId() === c.id) {
              <tk-markdown-editor
                ariaLabel="Edit comment"
                submitHint="to save"
                [maxLength]="20000"
                [uploadHandler]="uploadHandler()"
                [mentionSearch]="mentionSearch()"
                [mentions]="c.mentions"
                [(value)]="editDraft"
                (submitted)="saveEdit(c)"
                (cancelled)="editingId.set(null)"
              >
                <button mat-button type="button" (click)="editingId.set(null)">Cancel</button>
                <button
                  mat-flat-button
                  type="button"
                  data-testid="comment-save"
                  (click)="saveEdit(c)"
                >
                  Save
                </button>
              </tk-markdown-editor>
            } @else {
              <tk-markdown class="cmt-b" [source]="c.body" [mentions]="c.mentions" />
            }
          </article>
        } @else {
          @for (line of item.group.lines; track line.id) {
            <div class="ev">
              <span class="ic"><tk-icon [name]="line.icon" [size]="14" /></span>
              <span class="ev-t">
                <b>{{ line.actor }}</b> {{ line.verb }}
                @if (line.from) {
                  <span class="pill">{{ line.from }}</span>
                }
                @if (line.from && line.to) {
                  →
                }
                @if (line.to && !line.ticketKey) {
                  <span class="pill">{{ line.to }}</span>
                }
                @if (line.ticketKey) {
                  <a class="tk-link tnum" [routerLink]="['/tickets', line.ticketKey]">{{
                    line.ticketKey
                  }}</a>
                }
                @if (line.channel) {
                  <span class="chan">via {{ line.channel }}</span>
                }
                <span class="when" [title]="line.occurredAt | absoluteTime"
                  >· {{ line.occurredAt | relativeTime }}</span
                >
              </span>
            </div>
          }
        }
      } @empty {
        <div class="none">
          {{
            tab() === 'comments'
              ? 'No comments yet.'
              : historyLoading()
                ? 'Loading…'
                : 'No activity yet.'
          }}
        </div>
      }
    </div>

    @if (canComment()) {
      <tk-markdown-editor
        class="composer"
        data-testid="comment-composer"
        ariaLabel="New comment"
        placeholder="Leave a comment… Markdown supported, @ to mention, ticket keys link automatically"
        submitHint="to comment"
        [minRows]="2"
        [maxLength]="20000"
        [uploadHandler]="uploadHandler()"
        [mentionSearch]="mentionSearch()"
        [(value)]="draft"
        (submitted)="submit()"
      >
        <button
          mat-stroked-button
          type="button"
          data-testid="comment-submit"
          [disabled]="!draft().trim() || posting()"
          (click)="submit()"
        >
          Comment
        </button>
      </tk-markdown-editor>
    }
  `,
  styleUrl: './ticket-activity.component.scss',
})
export class TicketActivityComponent {
  private readonly confirm = inject(ConfirmService);

  readonly comments = input.required<readonly Comment[]>();
  readonly commentCount = input(0);
  readonly history = input<readonly ActivityEntry[]>([]);
  readonly historyUsers = input<ReadonlyMap<string, UserRef>>(new Map());
  readonly hasMoreHistory = input(false);
  readonly historyLoading = input(false);
  readonly canComment = input(false);
  readonly add = input.required<(body: string) => Promise<boolean>>();
  readonly uploadHandler = input<MarkdownUploadHandler | null>(null);
  readonly mentionSearch = input<MentionSearch | null>(null);

  readonly tabChange = output<ActivityTab>();
  readonly loadMoreHistory = output<void>();
  readonly loadAllComments = output<void>();
  readonly edited = output<{ id: string; body: string }>();
  readonly deleted = output<string>();

  protected readonly tab = signal<ActivityTab>('all');
  protected readonly draft = signal('');
  protected readonly posting = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');

  protected readonly tabOptions = computed(() => [
    { value: 'all' as ActivityTab, label: 'All' },
    { value: 'comments' as ActivityTab, label: `Comments ${this.commentCount()}` },
    { value: 'history' as ActivityTab, label: 'History' },
  ]);

  protected readonly feed = computed<FeedItem[]>(() => {
    const tab = this.tab();
    const items: FeedItem[] = [];
    if (tab !== 'history')
      for (const comment of this.comments())
        items.push({ kind: 'comment', at: comment.createdAt, comment });
    if (tab !== 'comments') {
      const entries = [...this.history()]
        .filter((e) => tab === 'history' || !e.action.startsWith('comment.'))
        .reverse()
        .map((e) => describeEntry(e, this.historyUsers()));
      for (const group of groupEntries(entries))
        items.push({ kind: 'history', at: group.occurredAt, group });
    }
    return items.sort((a, b) => a.at.localeCompare(b.at));
  });

  setTab(tab: ActivityTab): void {
    this.tab.set(tab);
    this.tabChange.emit(tab);
  }

  protected async submit(): Promise<void> {
    const body = this.draft().trim();
    if (!body || this.posting()) return;
    this.posting.set(true);
    const ok = await this.add()(body);
    this.posting.set(false);
    if (ok) this.draft.set('');
  }

  protected startEdit(comment: Comment): void {
    this.editDraft.set(comment.body);
    this.editingId.set(comment.id);
  }

  protected saveEdit(comment: Comment): void {
    const body = this.editDraft().trim();
    if (!body) return;
    if (body !== comment.body) this.edited.emit({ id: comment.id, body });
    this.editingId.set(null);
  }

  protected async remove(comment: Comment): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Delete this comment?',
      message: 'The comment is replaced by a "Comment deleted" placeholder.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) this.deleted.emit(comment.id);
  }
}
