import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTooltip } from '@angular/material/tooltip';
import { provideIcons } from '@ng-icons/core';
import {
  tablerDownload,
  tablerFile,
  tablerFileTypePdf,
  tablerFileZip,
  tablerPaperclip,
  tablerTrash,
  tablerUpload,
} from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { DocAttachmentsApi } from '@core/docs/doc-attachments.api';
import { Doc, DocAttachment, MAX_ATTACHMENTS_PER_PAGE } from '@core/docs/doc.models';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import {
  ATTACHMENT_ACCEPT,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
} from '@core/tickets/ticket-attachments';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';

/// The page's attachments panel (spec 1.8): images pasted in the editor and other uploaded files,
/// with download, delete (uploader or Owner) and upload by button or drop. A page section
/// (`provideDocPageSection`, footer).
@Component({
  selector: 'tk-doc-attachments-section',
  imports: [MatTooltip, RelativeTimePipe, AbsoluteTimePipe, IconComponent, SkeletonRowsComponent],
  viewProviders: [
    provideIcons({
      tablerDownload,
      tablerFile,
      tablerFileTypePdf,
      tablerFileZip,
      tablerPaperclip,
      tablerTrash,
      tablerUpload,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'doc-attachments',
    '[class.over]': 'dragOver()',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'dragOver.set(false)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    @if (items().length || pending() || canUpload()) {
      <div class="sec-h">
        <h2>Attachments</h2>
        @if (items().length) {
          <span class="n tnum" data-testid="doc-attachments-count">{{ items().length }}</span>
        }
        @if (canUpload()) {
          <button
            type="button"
            class="add"
            data-testid="doc-attachments-upload"
            [disabled]="full()"
            (click)="input.click()"
          >
            <tk-icon name="tablerPaperclip" [size]="14" />Attach
          </button>
          <input
            #input
            type="file"
            multiple
            hidden
            data-testid="doc-attachments-input"
            [accept]="accept"
            (change)="onPicked(input)"
          />
        }
      </div>
      @if (status() === 'loading' && !items().length) {
        <tk-skeleton-rows [count]="2" />
      } @else if (items().length || pending()) {
        <div class="box" role="list">
          @for (a of items(); track a.id) {
            <div class="arow" role="listitem" [attr.data-testid]="'doc-attachment-' + a.fileName">
              <a
                class="thumb"
                [href]="a.url"
                target="_blank"
                rel="noopener"
                [attr.aria-label]="'Open ' + a.fileName"
              >
                @if (a.isImage) {
                  <img [src]="a.url" [alt]="a.fileName" loading="lazy" />
                } @else {
                  <tk-icon [name]="iconFor(a)" [size]="20" />
                }
              </a>
              <span class="meta">
                <a
                  class="name"
                  [href]="a.isImage ? a.url : downloadUrl(a)"
                  target="_blank"
                  rel="noopener"
                  >{{ a.fileName }}</a
                >
                <span class="sub">
                  {{ size(a.sizeBytes) }} · {{ a.uploadedBy.displayName }} ·
                  <span [title]="a.uploadedAt | absoluteTime">{{
                    a.uploadedAt | relativeTime
                  }}</span>
                </span>
              </span>
              <span class="actions">
                <a
                  class="tk-icon-btn"
                  [href]="downloadUrl(a)"
                  download
                  matTooltip="Download"
                  [attr.aria-label]="'Download ' + a.fileName"
                >
                  <tk-icon name="tablerDownload" [size]="14" />
                </a>
                @if (a.canDelete) {
                  <button
                    type="button"
                    class="tk-icon-btn"
                    matTooltip="Delete"
                    [attr.aria-label]="'Delete ' + a.fileName"
                    data-testid="doc-attachment-delete"
                    (click)="remove(a)"
                  >
                    <tk-icon name="tablerTrash" [size]="14" />
                  </button>
                }
              </span>
            </div>
          }
          @if (pending()) {
            <div class="arow pending" role="listitem">
              <span class="thumb"><tk-icon name="tablerUpload" [size]="16" /></span>
              <span class="meta"
                ><span class="name"
                  >Uploading {{ pending() }} {{ pending() === 1 ? 'file' : 'files' }}…</span
                ></span
              >
            </div>
          }
        </div>
      } @else {
        <p class="none">
          No attachments yet. Paste or drop images into the editor, or drop files here.
        </p>
      }
    }
  `,
  styleUrl: './doc-attachments-section.component.scss',
})
export class DocAttachmentsSectionComponent {
  private readonly api = inject(DocAttachmentsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly doc = input.required<Doc>();

  protected readonly accept = ATTACHMENT_ACCEPT;
  protected readonly items = signal<readonly DocAttachment[]>([]);
  protected readonly pending = signal(0);
  protected readonly status = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly dragOver = signal(false);
  protected readonly canUpload = computed(() => this.doc().permissions.canEdit);
  protected readonly full = computed(
    () => this.items().length + this.pending() >= MAX_ATTACHMENTS_PER_PAGE,
  );

  constructor() {
    effect(() => {
      const key = this.doc().key;
      untracked(() => void this.load(key));
    });
    this.api.changes.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((change) => {
      if (change.docKey !== this.doc().key.toUpperCase()) return;
      if (change.kind === 'added')
        this.items.update((list) =>
          list.some((a) => a.id === change.attachment.id) ? list : [...list, change.attachment],
        );
      else this.items.update((list) => list.filter((a) => a.id !== change.id));
    });
  }

  protected size(bytes: number): string {
    return formatBytes(bytes);
  }

  protected downloadUrl(attachment: DocAttachment): string {
    return this.api.downloadUrl(attachment);
  }

  protected iconFor(attachment: DocAttachment): string {
    if (attachment.contentType === 'application/pdf') return 'tablerFileTypePdf';
    if (attachment.contentType === 'application/zip') return 'tablerFileZip';
    return 'tablerFile';
  }

  protected onPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.uploadAll(files);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.canUpload() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.canUpload() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(false);
    void this.uploadAll(Array.from(event.dataTransfer.files));
  }

  protected async remove(attachment: DocAttachment): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${attachment.fileName}?`,
      message: 'The file is removed for everyone. Markdown that embeds it shows a broken image.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const before = this.items();
    this.items.update((list) => list.filter((a) => a.id !== attachment.id));
    try {
      await this.api.delete(this.doc().key, attachment.id);
    } catch (error) {
      this.items.set(before);
      this.toast.error(error);
    }
  }

  private async load(key: string): Promise<void> {
    this.status.set('loading');
    try {
      this.items.set(await firstValueFrom(this.api.list(key)));
      this.status.set('loaded');
    } catch {
      this.status.set('error');
    }
  }

  private async uploadAll(files: File[]): Promise<void> {
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length)
      this.toast.warning(
        `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than 10 MB.`,
      );
    for (const file of files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)) {
      this.pending.update((n) => n + 1);
      try {
        await this.api.upload(this.doc().key, file);
      } catch (error) {
        this.toast.error(error);
      } finally {
        this.pending.update((n) => n - 1);
      }
    }
  }
}
