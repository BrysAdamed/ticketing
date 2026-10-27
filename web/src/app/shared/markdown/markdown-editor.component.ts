import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { KbdComponent } from '../ui/kbd/kbd.component';
import { MarkdownViewerComponent } from './markdown-viewer.component';

export type MarkdownEditorMode = 'write' | 'preview';

/// Uploads a pasted or dropped file and returns the markdown to insert in its place (for example
/// an image embed), or null to insert nothing (the handler reports its own errors).
export type MarkdownUploadHandler = (file: File) => Promise<string | null>;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// Markdown textarea with Write / Preview tabs. Ctrl+Enter (⌘↵) emits `submitted`, Escape emits
/// `cancelled`. Projected content is placed in the footer (e.g. Save / Cancel buttons). With an
/// `uploadHandler`, pasted or dropped files are uploaded and replaced by the markdown it returns.
@Component({
  selector: 'tk-markdown-editor',
  imports: [CdkTextareaAutosize, MarkdownViewerComponent, KbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.dragging]': 'dragging()' },
  template: `
    <div class="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        [class.on]="mode() === 'write'"
        [attr.aria-selected]="mode() === 'write'"
        (click)="mode.set('write')"
      >
        Write
      </button>
      <button
        type="button"
        role="tab"
        data-testid="markdown-preview-tab"
        [class.on]="mode() === 'preview'"
        [attr.aria-selected]="mode() === 'preview'"
        (click)="mode.set('preview')"
      >
        Preview
      </button>
    </div>
    @if (mode() === 'write') {
      <textarea
        #textarea
        cdkTextareaAutosize
        [cdkAutosizeMinRows]="minRows()"
        [cdkAutosizeMaxRows]="maxRows()"
        [placeholder]="placeholder()"
        [attr.aria-label]="ariaLabel()"
        [attr.maxlength]="maxLength()"
        [value]="value()"
        (input)="value.set(textarea.value)"
        (keydown)="onKeydown($event)"
        (paste)="onPaste($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      ></textarea>
    } @else {
      <div class="preview">
        @if (value().trim()) {
          <tk-markdown [source]="value()" />
        } @else {
          <span class="nothing">Nothing to preview</span>
        }
      </div>
    }
    <div class="footer">
      @if (submitHint(); as hint) {
        <span class="hint"
          ><tk-kbd>{{ submitKeys }}</tk-kbd> {{ hint }}</span
        >
      }
      @if (uploading() > 0) {
        <span class="hint" role="status" data-testid="markdown-uploading">Uploading…</span>
      } @else if (uploadHandler()) {
        <span class="hint attach">Paste or drop files to attach</span>
      }
      <span class="actions"><ng-content /></span>
    </div>
  `,
  styles: `
    :host {
      display: block;
      border: 1px solid var(--tk-border-strong);
      border-radius: var(--tk-radius-lg);
      background: var(--tk-surface);
      box-shadow: var(--tk-shadow-xs);
    }
    :host(.dragging) {
      border-color: var(--tk-accent);
      background: var(--tk-accent-subtle);
    }
    .attach {
      font-size: var(--tk-text-xs);
    }
    :host(:focus-within) {
      border-color: var(--tk-accent);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
    }
    .tabs {
      display: flex;
      gap: 2px;
      padding: 6px 8px 0;
    }
    .tabs button {
      height: 24px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-sm);
      background: none;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
      cursor: pointer;
    }
    .tabs button.on {
      background: var(--tk-bg-active);
      color: var(--tk-text);
    }
    textarea {
      display: block;
      width: 100%;
      padding: 10px 14px;
      border: 0;
      outline: 0;
      resize: none;
      background: none;
      color: var(--tk-text);
      font: inherit;
      font-size: var(--tk-text-md);
      line-height: 22px;
    }
    textarea::placeholder {
      color: var(--tk-text-subtle);
    }
    .preview {
      padding: 10px 14px;
      min-height: 64px;
    }
    .nothing {
      color: var(--tk-text-subtle);
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px 6px 14px;
      border-top: 1px solid var(--tk-border-subtle);
    }
    .footer:not(:has(.hint)):has(.actions:empty) {
      display: none;
    }
    .hint {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .actions {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }
  `,
})
export class MarkdownEditorComponent {
  readonly value = model('');
  readonly mode = model<MarkdownEditorMode>('write');
  readonly placeholder = input('Write in markdown…');
  readonly ariaLabel = input('Markdown');
  /// Footer hint after the submit keys; null hides it (when the host shows its own).
  readonly submitHint = input<string | null>('to submit');
  readonly minRows = input(3);
  readonly maxRows = input(20);
  readonly maxLength = input<number | null>(null);
  readonly uploadHandler = input<MarkdownUploadHandler | null>(null);

  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly uploading = signal(0);
  protected readonly dragging = signal(false);
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  focus(): void {
    this.mode.set('write');
    queueMicrotask(() => this.textarea()?.nativeElement.focus());
  }

  protected onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!this.uploadHandler() || files.length === 0) return;
    event.preventDefault();
    for (const file of files) void this.upload(file);
  }

  protected onDragOver(event: DragEvent): void {
    if (!this.uploadHandler() || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    this.dragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!this.uploadHandler() || files.length === 0) return;
    event.preventDefault();
    for (const file of files) void this.upload(file);
  }

  /// Inserts a placeholder at the caret, then swaps it for the handler's markdown (or removes it).
  async upload(file: File): Promise<void> {
    const handler = this.uploadHandler();
    if (!handler) return;
    const placeholder = `![Uploading ${file.name.replace(/[[\]]/g, '')}…]()`;
    this.insertAtCursor(placeholder);
    this.uploading.update((n) => n + 1);
    let markdown: string | null = null;
    try {
      markdown = await handler(file);
    } catch {
      markdown = null;
    } finally {
      this.value.update((text) => text.replace(placeholder, markdown ?? ''));
      this.uploading.update((n) => n - 1);
    }
  }

  private insertAtCursor(text: string): void {
    const textarea = this.textarea()?.nativeElement;
    const current = this.value();
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const before = current.slice(0, start);
    const insert = (before && !before.endsWith('\n') ? '\n' : '') + text + '\n';
    this.value.set(before + insert + current.slice(end));
    const caret = before.length + insert.length;
    queueMicrotask(() => textarea?.setSelectionRange(caret, caret));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submitted.emit(this.value());
    } else if (event.key === 'Escape') {
      this.cancelled.emit();
    }
  }
}
