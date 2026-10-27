import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { ToastService } from '../notify/toast.service';
import { UserRef } from './ticket.models';

/// Item of `GET /api/v1/tickets/{key}/attachments` (spec 4.8).
export interface Attachment {
  id: string;
  ticketId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  isImage: boolean;
  uploadedAt: string;
  uploadedBy: UserRef;
  /// `/api/v1/attachments/{id}`: images render inline, other types download.
  url: string;
  canDelete: boolean;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TICKET = 50;
export const ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.md,.csv,.json,.zip,image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,application/json,application/zip';

export type AttachmentChange = { kind: 'added'; ticketKey: string; attachment: Attachment } | { kind: 'removed'; ticketKey: string; id: string };

/// Ticket attachments: list, upload (multipart), delete, and the markdown editor upload hook that
/// turns a pasted or dropped image into `![name](/api/v1/attachments/{id})`.
@Injectable({ providedIn: 'root' })
export class TicketAttachments {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly changeSubject = new Subject<AttachmentChange>();

  /// Uploads and deletes made anywhere (section, editor paste), so open lists stay in sync.
  readonly changes: Observable<AttachmentChange> = this.changeSubject.asObservable();

  list(ticketKey: string): Observable<Attachment[]> {
    return this.api.get<Attachment[]>(`/tickets/${encodeURIComponent(ticketKey)}/attachments`);
  }

  async upload(ticketKey: string, file: File): Promise<Attachment> {
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
    const form = new FormData();
    form.append('file', file, file.name);
    const attachment = await firstValueFrom(this.api.post<Attachment>(`/tickets/${encodeURIComponent(ticketKey)}/attachments`, form));
    this.changeSubject.next({ kind: 'added', ticketKey: ticketKey.toUpperCase(), attachment });
    return attachment;
  }

  async delete(ticketKey: string, id: string): Promise<void> {
    await firstValueFrom(this.api.delete(`/attachments/${id}`));
    this.changeSubject.next({ kind: 'removed', ticketKey: ticketKey.toUpperCase(), id });
  }

  downloadUrl(attachment: Attachment): string {
    return `${attachment.url}?download=true`;
  }

  /// The `uploadHandler` for `tk-markdown-editor` on a ticket: uploads the file and returns the
  /// markdown to insert (an image embed or a link), or null after showing the error.
  markdownUploader(ticketKey: () => string): (file: File) => Promise<string | null> {
    return async (file) => {
      try {
        const attachment = await this.upload(ticketKey(), file);
        const name = attachment.fileName.replace(/[[\]]/g, '');
        return attachment.isImage ? `![${name}](${attachment.url})` : `[${name}](${this.downloadUrl(attachment)})`;
      } catch (error) {
        this.toast.error(error instanceof ApiError || !(error instanceof Error) ? error : error.message);
        return null;
      }
    };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
