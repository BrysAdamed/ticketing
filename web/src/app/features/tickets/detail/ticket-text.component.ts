import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// Resolves true when the value was saved (the editor closes), false to keep editing.
export type TextSave = (value: string) => Promise<boolean>;

/// Title shown as a heading; click or `E` turns it into an input. Enter or blur saves, Esc cancels.
@Component({
  selector: 'tk-ticket-title',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing()) {
      <input
        #input
        class="title-input"
        aria-label="Title"
        maxlength="255"
        data-testid="title-input"
        [value]="draft()"
        (input)="draft.set(input.value)"
        (keydown.enter)="$event.preventDefault(); commit()"
        (keydown.escape)="$event.stopPropagation(); cancel()"
        (blur)="commit()"
      />
    } @else {
      <h1
        class="title"
        [class.editable]="canEdit()"
        [attr.tabindex]="canEdit() ? 0 : null"
        [attr.role]="canEdit() ? 'button' : null"
        data-testid="ticket-title"
        (click)="start()"
        (keydown.enter)="start()"
      >
        {{ value() }}
      </h1>
    }
  `,
  styles: `
    .title,
    .title-input {
      margin: 0;
      padding: 2px 6px;
      margin-left: -6px;
      width: calc(100% + 12px);
      font-size: var(--tk-text-2xl);
      line-height: var(--tk-leading-2xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
      border-radius: var(--tk-radius-md);
      color: var(--tk-text);
    }
    .title.editable {
      cursor: text;
    }
    .title.editable:hover {
      background: var(--tk-bg-hover);
    }
    .title-input {
      display: block;
      border: 1px solid var(--tk-accent);
      outline: 0;
      background: var(--tk-surface);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
      font-family: inherit;
    }
  `,
})
export class TicketTitleComponent {
  readonly value = input.required<string>();
  readonly canEdit = input(false);
  readonly save = input.required<TextSave>();

  readonly editingChange = output<boolean>();

  protected readonly editing = signal(false);
  protected readonly draft = signal('');
  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('input');
  private saving = false;

  start(): void {
    if (!this.canEdit() || this.editing()) return;
    this.draft.set(this.value());
    this.editing.set(true);
    this.editingChange.emit(true);
    queueMicrotask(() => {
      this.inputEl()?.nativeElement.focus();
      this.inputEl()?.nativeElement.select();
    });
  }

  protected async commit(): Promise<void> {
    if (!this.editing() || this.saving) return;
    const text = this.draft().replace(/\s+/g, ' ').trim();
    if (!text || text === this.value()) {
      this.cancel();
      return;
    }
    this.saving = true;
    const saved = await this.save()(text);
    this.saving = false;
    if (saved) this.close();
  }

  protected cancel(): void {
    this.close();
  }

  private close(): void {
    this.editing.set(false);
    this.editingChange.emit(false);
  }
}

/// Rendered markdown description; Edit (or `E D`, or a click on the empty state) opens the
/// markdown editor with preview. Ctrl+Enter or Save stores it, Esc cancels.
@Component({
  selector: 'tk-ticket-description',
  imports: [MarkdownEditorComponent, MarkdownViewerComponent, MatButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (editing()) {
      <tk-markdown-editor
        data-testid="description-editor"
        ariaLabel="Description"
        placeholder="Describe the work. Markdown, task lists and ticket keys are supported."
        submitHint="to save"
        [minRows]="6"
        [maxRows]="30"
        [maxLength]="50000"
        [(value)]="draft"
        (submitted)="commit()"
        (cancelled)="cancel()"
      >
        <button mat-button type="button" (click)="cancel()">Cancel</button>
        <button mat-flat-button type="button" data-testid="description-save" [disabled]="saving()" (click)="commit()">Save</button>
      </tk-markdown-editor>
    } @else if (value()) {
      <div class="body" data-testid="ticket-description">
        <tk-markdown [source]="value()" />
        @if (canEdit()) {
          <button type="button" class="tk-icon-btn edit" aria-label="Edit description" data-testid="description-edit" (click)="start()">
            <tk-icon name="tablerPencil" [size]="14" />
          </button>
        }
      </div>
    } @else if (canEdit()) {
      <button type="button" class="placeholder" data-testid="description-edit" (click)="start()">Add a description…</button>
    } @else {
      <p class="none">No description.</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .body {
      position: relative;
      max-width: 72ch;
    }
    .edit {
      position: absolute;
      top: -4px;
      right: -36px;
      opacity: 0;
    }
    .body:hover .edit,
    .edit:focus-visible {
      opacity: 1;
    }
    .placeholder {
      display: block;
      width: 100%;
      padding: 10px 12px;
      border: 1px dashed var(--tk-border);
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-subtle);
      font: inherit;
      text-align: left;
      cursor: text;
    }
    .placeholder:hover {
      background: var(--tk-bg-hover);
    }
    .none {
      color: var(--tk-text-subtle);
      margin: 0;
    }
  `,
})
export class TicketDescriptionComponent {
  readonly value = input<string | null>(null);
  readonly canEdit = input(false);
  readonly save = input.required<TextSave>();

  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly draft = signal('');
  private readonly editor = viewChild(MarkdownEditorComponent);

  start(): void {
    if (!this.canEdit() || this.editing()) return;
    this.draft.set(this.value() ?? '');
    this.editing.set(true);
    queueMicrotask(() => this.editor()?.focus());
  }

  protected async commit(): Promise<void> {
    if (this.saving()) return;
    if (this.draft().trim() === (this.value() ?? '').trim()) {
      this.cancel();
      return;
    }
    this.saving.set(true);
    const saved = await this.save()(this.draft());
    this.saving.set(false);
    if (saved) this.editing.set(false);
  }

  protected cancel(): void {
    this.editing.set(false);
  }
}
