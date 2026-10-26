import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { KbdComponent } from '../ui/kbd/kbd.component';
import { MarkdownViewerComponent } from './markdown-viewer.component';

export type MarkdownEditorMode = 'write' | 'preview';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// Markdown textarea with Write / Preview tabs. Ctrl+Enter (⌘↵) emits `submitted`, Escape emits
/// `cancelled`. Projected content is placed in the footer (e.g. Save / Cancel buttons).
@Component({
  selector: 'tk-markdown-editor',
  imports: [CdkTextareaAutosize, MarkdownViewerComponent, KbdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      <span class="hint"
        ><tk-kbd>{{ submitKeys }}</tk-kbd> {{ submitHint() }}</span
      >
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
  readonly submitHint = input('to submit');
  readonly minRows = input(3);
  readonly maxRows = input(20);
  readonly maxLength = input<number | null>(null);

  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  focus(): void {
    this.mode.set('write');
    queueMicrotask(() => this.textarea()?.nativeElement.focus());
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
