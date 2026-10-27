import { inject, Injectable } from '@angular/core';
import { firstValueFrom, Observable, Subject } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { MAX_ATTACHMENT_BYTES } from '../tickets/ticket-attachments';
import { DocAttachment } from './doc.models';

export type DocAttachmentChange =
  | { kind: 'added'; docKey: string; attachment: DocAttachment }
  | { kind: 'removed'; docKey: string; id: string };

/// Files attached to a page (spec 12): list, upload (multipart), delete, and the markdown that
/// embeds an upload (`![name](/api/v1/attachments/{id})` for images, a download link otherwise).
@Injectable({ providedIn: 'root' })
export class DocAttachmentsApi {
  private readonly api = inject(ApiClient);
  private readonly changeSubject = new Subject<DocAttachmentChange>();

  /// Uploads and deletes made anywhere (attachments panel, editor paste), so open lists stay in sync.
  readonly changes: Observable<DocAttachmentChange> = this.changeSubject.asObservable();

  list(docKey: string): Observable<DocAttachment[]> {
    return this.api.get<DocAttachment[]>(`/docs/${encodeURIComponent(docKey)}/attachments`);
  }

  async upload(docKey: string, file: File): Promise<DocAttachment> {
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
    const form = new FormData();
    form.append('file', file, file.name);
    const attachment = await firstValueFrom(
      this.api.post<DocAttachment>(`/docs/${encodeURIComponent(docKey)}/attachments`, form),
    );
    this.changeSubject.next({ kind: 'added', docKey: docKey.toUpperCase(), attachment });
    return attachment;
  }

  async delete(docKey: string, id: string): Promise<void> {
    await firstValueFrom(this.api.delete(`/attachments/${id}`));
    this.changeSubject.next({ kind: 'removed', docKey: docKey.toUpperCase(), id });
  }

  downloadUrl(attachment: DocAttachment): string {
    return `${attachment.url}?download=true`;
  }

  /// The markdown that references an uploaded file in the page.
  markdownFor(attachment: DocAttachment): string {
    const name = attachment.fileName.replace(/[[\]]/g, '');
    return attachment.isImage
      ? `![${name}](${attachment.url})`
      : `[${name}](${this.downloadUrl(attachment)})`;
  }
}
