import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { toApiError } from '../api/api-error';
import { ToastService } from '../notify/toast.service';
import { DocKind } from './doc.models';
import { DocsApi } from './docs.api';

/// What to export: a page or diagram (optionally an older `version`) or a folder.
export interface DocExportRequest {
  key: string;
  title: string;
  kind: DocKind;
  version?: number | null;
}

/// Downloads doc PDFs (docs refinement 1.11). The server renders them; a page downloads directly,
/// a folder export runs in the background (the user keeps working) and ends with a toast that
/// offers the download. One export per doc and version at a time.
@Injectable({ providedIn: 'root' })
export class DocExports {
  private readonly api = inject(DocsApi);
  private readonly toast = inject(ToastService);
  private readonly running = signal<ReadonlySet<string>>(new Set());

  /// Keys (`KEY` or `KEY@version`) being exported right now.
  readonly exporting = this.running.asReadonly();

  isExporting(key: string, version?: number | null): boolean {
    return this.running().has(exportId(key, version));
  }

  async export(request: DocExportRequest): Promise<void> {
    const id = exportId(request.key, request.version);
    if (this.running().has(id)) {
      this.toast.show(`Already exporting "${request.title}"`);
      return;
    }
    this.running.update((set) => new Set(set).add(id));
    const folder = request.kind === 'Folder';
    this.toast.show(
      folder
        ? `Exporting "${request.title}" to PDF. You can keep working; it may take a minute.`
        : `Preparing the PDF of "${request.title}"…`,
      { durationMs: 120_000 },
    );
    try {
      const response = await fetch(
        this.api.pdfExportUrl(request.key, request.version, browserTimeZone()),
        { credentials: 'same-origin', headers: { Accept: 'application/pdf' } },
      );
      if (!response.ok) throw await problemOf(response);
      const blob = await response.blob();
      const name = pdfFileName(response.headers.get('Content-Disposition')) ?? `${request.key}.pdf`;
      if (folder) {
        this.toast.success(`The PDF of "${request.title}" is ready`, {
          action: { label: 'Download', run: () => saveBlob(blob, name) },
          durationMs: 120_000,
        });
      } else {
        saveBlob(blob, name);
        this.toast.success(`Downloaded ${name}`);
      }
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.running.update((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  }
}

/// The file name of a `Content-Disposition` header (`filename*=UTF-8''…` preferred).
export function pdfFileName(disposition: string | null): string | null {
  if (!disposition) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      return null;
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
  return plain ? plain[1].trim() : null;
}

function exportId(key: string, version?: number | null): string {
  return version ? `${key}@${version}` : key;
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

async function problemOf(response: Response): Promise<Error> {
  const body = await response.text().catch(() => '');
  return toApiError(
    new HttpErrorResponse({
      status: response.status,
      error: body,
      headers: new HttpHeaders({ 'Retry-After': response.headers.get('Retry-After') ?? '' }),
      url: response.url,
    }),
  );
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
