import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { provideIcons } from '@ng-icons/core';
import { tablerMessageCircle, tablerPencil, tablerTrash } from '@ng-icons/tabler-icons';
import { Doc } from '@core/docs/doc.models';
import { ConfirmService } from '@core/notify/confirm.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { DocStore } from '../../doc/doc.store';
import { DocCommentsStore, DocThreadComment } from './doc-comments.store';

/// The comment thread below a page or diagram (docs refinement D12, spec 6.9 rules): oldest first,
/// markdown with the shared renderer, edit and delete your own (Owners delete any), "edited"
/// marker, deleted placeholders and a composer for writers (`Shift+C` focuses it). A page section
/// (`provideDocPageSection`, footer); `#comments` scrolls to it.
@Component({
  selector: 'tk-doc-comments-section',
  imports: [
    MatButtonModule,
    MarkdownEditorComponent,
    MarkdownViewerComponent,
    AbsoluteTimePipe,
    RelativeTimePipe,
    AvatarComponent,
    IconComponent,
    SkeletonRowsComponent,
  ],
  providers: [DocCommentsStore],
  viewProviders: [provideIcons({ tablerMessageCircle, tablerPencil, tablerTrash })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'comments', 'data-testid': 'doc-comments' },
  template: `
    <div class="sec-h">
      <h2>Comments</h2>
      @if (doc().commentCount) {
        <span class="n tnum" data-testid="doc-comments-count">{{ doc().commentCount }}</span>
      }
    </div>

    @if (store.status() === 'loading') {
      <tk-skeleton-rows [count]="2" />
    } @else if (store.status() === 'error') {
      <p class="none">
        Couldn't load the comments.
        <button type="button" class="link" (click)="reload()">Try again</button>
      </p>
    } @else {
      <div class="thread">
        @for (c of store.items(); track c.id) {
          <article
            class="cmt"
            [class.deleted]="c.deleted"
            [class.pending]="c.pending"
            [attr.data-testid]="'doc-comment-' + c.id"
            [attr.aria-busy]="c.pending ? true : null"
          >
            <div class="cmt-h">
              <tk-avatar [userId]="c.author.id" [name]="c.author.displayName" [size]="24" />
              <b>{{ c.author.displayName }}</b>
              @if (!c.author.isActive) {
                <span class="subtle">(deactivated)</span>
              }
              <span class="when" [title]="c.createdAt | absoluteTime">{{
                c.pending ? 'Posting…' : (c.createdAt | relativeTime)
              }}</span>
              @if (c.editedAt && !c.deleted) {
                <span
                  class="when"
                  data-testid="doc-comment-edited"
                  [title]="c.editedAt | absoluteTime"
                  >· edited</span
                >
              }
              <span class="right">
                @if (c.canEdit && editingId() !== c.id) {
                  <button
                    type="button"
                    class="tk-icon-btn tk-icon-btn-sm"
                    aria-label="Edit comment"
                    data-testid="doc-comment-edit"
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
                    data-testid="doc-comment-delete"
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
                class="cmt-edit"
                ariaLabel="Edit comment"
                submitHint="to save"
                [maxLength]="maxLength"
                [(value)]="editDraft"
                (submitted)="saveEdit(c)"
                (cancelled)="editingId.set(null)"
              >
                <button mat-button type="button" (click)="editingId.set(null)">Cancel</button>
                <button
                  mat-flat-button
                  type="button"
                  data-testid="doc-comment-save"
                  [disabled]="!editDraft().trim()"
                  (click)="saveEdit(c)"
                >
                  Save
                </button>
              </tk-markdown-editor>
            } @else {
              <tk-markdown class="cmt-b" [source]="c.body" />
            }
          </article>
        } @empty {
          <p class="none" data-testid="doc-comments-empty">
            {{
              doc().permissions.canEdit
                ? 'No comments yet. Start the discussion below.'
                : 'No comments yet.'
            }}
          </p>
        }
      </div>
      @if (store.nextCursor()) {
        <button
          type="button"
          class="link more"
          data-testid="doc-comments-more"
          [disabled]="store.loadingMore()"
          (click)="store.loadMore()"
        >
          {{ store.loadingMore() ? 'Loading…' : 'Show more comments' }}
        </button>
      }
    }

    @if (doc().permissions.canEdit) {
      <tk-markdown-editor
        #composer
        class="composer"
        data-testid="doc-comment-composer"
        ariaLabel="New comment"
        placeholder="Leave a comment… Markdown supported, ticket keys link automatically"
        submitHint="to comment"
        [minRows]="2"
        [maxLength]="maxLength"
        [(value)]="draft"
        (submitted)="submit()"
      >
        <button
          mat-stroked-button
          type="button"
          data-testid="doc-comment-submit"
          [disabled]="!draft().trim()"
          (click)="submit()"
        >
          Comment
        </button>
      </tk-markdown-editor>
    }
  `,
  styleUrl: './doc-comments-section.component.scss',
})
export class DocCommentsSectionComponent {
  private readonly confirm = inject(ConfirmService);
  private readonly docStore = inject(DocStore, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private scrolledToHash = false;

  protected readonly store = inject(DocCommentsStore);
  protected readonly maxLength = 20000;
  protected readonly draft = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');
  private readonly composer = viewChild<MarkdownEditorComponent>('composer');

  readonly doc = input.required<Doc>();
  private readonly key = computed(() => this.doc().key);

  constructor() {
    effect(() => {
      const key = this.key();
      untracked(() => void this.load(key));
    });
    inject(ShortcutService).registerScoped([
      {
        keys: 'shift+c',
        section: 'Docs',
        description: 'Comment on the doc',
        handler: (event) => {
          const composer = this.composer();
          if (!composer) return;
          event.preventDefault();
          this.host.nativeElement.scrollIntoView({ block: 'end' });
          composer.focus();
        },
      },
    ]);
  }

  protected reload(): void {
    void this.load(this.doc().key);
  }

  protected async submit(): Promise<void> {
    const body = this.draft();
    if (!body.trim()) return;
    this.draft.set('');
    if (!(await this.store.add(body)) && !this.draft()) this.draft.set(body);
  }

  protected startEdit(comment: DocThreadComment): void {
    this.editDraft.set(comment.body);
    this.editingId.set(comment.id);
  }

  protected saveEdit(comment: DocThreadComment): void {
    const body = this.editDraft();
    if (!body.trim()) return;
    this.editingId.set(null);
    void this.store.edit(comment.id, body);
  }

  protected async remove(comment: DocThreadComment): Promise<void> {
    const ok = await this.confirm.confirm({
      title: 'Delete this comment?',
      message: 'The comment is replaced by a "Comment deleted" placeholder.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await this.store.remove(comment.id);
  }

  private async load(key: string): Promise<void> {
    this.editingId.set(null);
    await this.store.load(key, (delta) => this.adjustCount(key, delta));
    if (this.scrolledToHash || location.hash !== '#comments') return;
    this.scrolledToHash = true;
    afterNextRender(() => this.host.nativeElement.scrollIntoView(), { injector: this.injector });
  }

  /// Keeps the doc's comment count (meta line, header) in step with this thread's writes.
  private adjustCount(key: string, delta: number): void {
    const doc = this.docStore?.doc();
    if (!doc || doc.key !== key) return;
    this.docStore!.set({ ...doc, commentCount: Math.max(0, doc.commentCount + delta) });
  }
}
