import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatTooltip } from '@angular/material/tooltip';
import { provideIcons } from '@ng-icons/core';
import { tablerDownload, tablerFile, tablerFileTypePdf, tablerFileZip, tablerPaperclip, tablerPhoto, tablerTrash, tablerUpload } from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { TicketCache } from '@core/tickets/ticket-cache';
import {
  Attachment,
  ATTACHMENT_ACCEPT,
  formatBytes,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TICKET,
  TicketAttachments,
} from '@core/tickets/ticket-attachments';
import { RelativeTimePipe, AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';

interface PendingUpload {
  id: number;
  name: string;
}

/// Attachments section of the ticket view (spec 4.8, I-07): thumbnails for images, download,
/// delete for the uploader or an Owner, and upload by button, drag and drop or paste in editors.
@Component({
  selector: 'tk-attachments-section',
  imports: [MatTooltip, RelativeTimePipe, AbsoluteTimePipe, IconComponent, SkeletonRowsComponent],
  viewProviders: [provideIcons({ tablerDownload, tablerFile, tablerFileTypePdf, tablerFileZip, tablerPaperclip, tablerPhoto, tablerTrash, tablerUpload })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'ticket-attachments',
    '[class.over]': 'dragOver()',
    '(dragenter)': 'onDragEnter($event)',
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    <div class="sec-h">
      <h2>Attachments</h2>
      @if (items().length) {
        <span class="n tnum" data-testid="attachments-count">{{ items().length }}</span>
      }
      @if (canUpload()) {
        <span class="right">
          <button type="button" class="add" data-testid="attachments-upload" [disabled]="full()" (click)="fileInput.click()">
            <tk-icon name="tablerPaperclip" [size]="14" />Attach
          </button>
          <input
            #fileInput
            type="file"
            multiple
            hidden
            data-testid="attachments-input"
            [accept]="accept"
            (change)="onPicked(fileInput)"
          />
        </span>
      }
    </div>

    @if (status() === 'loading' && !items().length) {
      <tk-skeleton-rows [count]="2" />
    } @else if (items().length || pending().length) {
      <div class="box" role="list">
        @for (pending of pending(); track pending.id) {
          <div class="arow pending" role="listitem" data-testid="attachment-uploading">
            <span class="thumb"><tk-icon name="tablerUpload" [size]="16" /></span>
            <span class="meta"><span class="name">{{ pending.name }}</span><span class="sub">Uploading…</span></span>
            <span class="bar"><i></i></span>
          </div>
        }
        @for (a of items(); track a.id) {
          <div class="arow" role="listitem" [attr.data-testid]="'attachment-row-' + a.fileName">
            <a class="thumb" [href]="a.url" target="_blank" rel="noopener" [attr.aria-label]="'Open ' + a.fileName">
              @if (a.isImage) {
                <img [src]="a.url" [alt]="a.fileName" loading="lazy" data-testid="attachment-thumb" />
              } @else {
                <tk-icon [name]="iconFor(a)" [size]="18" />
              }
            </a>
            <span class="meta">
              <a class="name" [href]="a.isImage ? a.url : downloadUrl(a)" [attr.target]="a.isImage ? '_blank' : null" rel="noopener">{{ a.fileName }}</a>
              <span class="sub">
                {{ size(a.sizeBytes) }} · {{ a.uploadedBy.displayName }} ·
                <span [title]="a.uploadedAt | absoluteTime">{{ a.uploadedAt | relativeTime }}</span>
              </span>
            </span>
            <span class="actions">
              <a class="tk-icon-btn" [href]="downloadUrl(a)" download [attr.aria-label]="'Download ' + a.fileName" matTooltip="Download" data-testid="attachment-download">
                <tk-icon name="tablerDownload" [size]="14" />
              </a>
              @if (a.canDelete) {
                <button type="button" class="tk-icon-btn" [attr.aria-label]="'Delete ' + a.fileName" matTooltip="Delete" data-testid="attachment-delete" (click)="remove(a)">
                  <tk-icon name="tablerTrash" [size]="14" />
                </button>
              }
            </span>
          </div>
        }
      </div>
    } @else if (canUpload()) {
      <button type="button" class="drop" data-testid="attachments-dropzone" (click)="fileInput()?.nativeElement?.click()">
        <tk-icon name="tablerUpload" [size]="16" />
        <span><b>Drop files here</b> or click to browse</span>
        <span class="hint">Images, PDF, text, CSV, JSON or ZIP · up to 10 MB</span>
      </button>
    } @else {
      <p class="none">No attachments.</p>
    }
    @if (dragOver()) {
      <div class="overlay" aria-hidden="true"><tk-icon name="tablerUpload" [size]="18" />Drop to attach to {{ ticketKey() }}</div>
    }
  `,
  styleUrl: './attachments-section.component.scss',
})
export class AttachmentsSectionComponent {
  private readonly attachments = inject(TicketAttachments);
  private readonly cache = inject(TicketCache);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  readonly ticketKey = input.required<string>();
  readonly ticketId = input.required<string>();
  readonly projectKey = input.required<string>();

  protected readonly accept = ATTACHMENT_ACCEPT;
  protected readonly items = signal<readonly Attachment[]>([]);
  protected readonly pending = signal<readonly PendingUpload[]>([]);
  protected readonly status = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  protected readonly dragOver = signal(false);
  protected readonly canUpload = computed(() => this.cache.peek(this.ticketKey())?.permissions.canEdit ?? false);
  protected readonly full = computed(() => this.items().length + this.pending().length >= MAX_ATTACHMENTS_PER_TICKET);
  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  private dragDepth = 0;
  private nextPendingId = 0;

  constructor() {
    effect(() => {
      const key = this.ticketKey();
      untracked(() => void this.load(key));
    });
    this.attachments.changes.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((change) => {
      if (change.ticketKey !== this.ticketKey().toUpperCase()) return;
      if (change.kind === 'added') this.items.update((list) => (list.some((a) => a.id === change.attachment.id) ? list : [...list, change.attachment]));
      else this.items.update((list) => list.filter((a) => a.id !== change.id));
    });
  }

  protected size(bytes: number): string {
    return formatBytes(bytes);
  }

  protected downloadUrl(attachment: Attachment): string {
    return this.attachments.downloadUrl(attachment);
  }

  protected iconFor(attachment: Attachment): string {
    if (attachment.contentType === 'application/pdf') return 'tablerFileTypePdf';
    if (attachment.contentType === 'application/zip') return 'tablerFileZip';
    return 'tablerFile';
  }

  protected onPicked(input: HTMLInputElement): void {
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.uploadAll(files);
  }

  protected onDragEnter(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragOver.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragOver.set(false);
    void this.uploadAll(Array.from(event.dataTransfer?.files ?? []));
  }

  protected async remove(attachment: Attachment): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${attachment.fileName}?`,
      message: 'The file is removed for everyone. Markdown that embeds it will show a broken image.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const before = this.items();
    this.items.update((list) => list.filter((a) => a.id !== attachment.id));
    try {
      await this.attachments.delete(this.ticketKey(), attachment.id);
    } catch (error) {
      this.items.set(before);
      this.toast.error(error);
    }
  }

  private acceptsDrag(event: DragEvent): boolean {
    return this.canUpload() && !!event.dataTransfer?.types.includes('Files');
  }

  private async load(key: string): Promise<void> {
    this.status.set('loading');
    try {
      this.items.set(await firstValueFrom(this.attachments.list(key)));
      this.status.set('loaded');
    } catch {
      this.status.set('error');
    }
  }

  private async uploadAll(files: File[]): Promise<void> {
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) this.toast.warning(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than 10 MB.`);
    for (const file of files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)) {
      const pending = { id: this.nextPendingId++, name: file.name };
      this.pending.update((list) => [...list, pending]);
      try {
        await this.attachments.upload(this.ticketKey(), file);
      } catch (error) {
        this.toast.error(error);
      } finally {
        this.pending.update((list) => list.filter((p) => p.id !== pending.id));
      }
    }
  }
}
