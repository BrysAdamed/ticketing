import {
  createCloseScrollStrategy,
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  FlexibleConnectedPositionStrategy,
  OverlayRef,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  output,
  signal,
  TemplateRef,
  untracked,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { AvatarComponent } from '../ui/domain/avatar.component';
import { KbdComponent } from '../ui/kbd/kbd.component';
import { caretPosition } from './caret-position';
import { MarkdownViewerComponent } from './markdown-viewer.component';
import {
  findMentionQuery,
  insertMention,
  MentionCandidate,
  MentionQuery,
  MentionSearch,
  MentionUser,
} from './mentions';

export type MarkdownEditorMode = 'write' | 'preview';

/// Uploads a pasted or dropped file and returns the markdown to insert in its place (for example
/// an image embed), or null to insert nothing (the handler reports its own errors).
export type MarkdownUploadHandler = (file: File) => Promise<string | null>;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MENTION_DEBOUNCE_MS = 150;
const MENTION_ROWS = 8;
let nextEditorId = 0;

/// Markdown textarea with Write / Preview tabs. Ctrl+Enter (⌘↵) emits `submitted`, Escape emits
/// `cancelled`. Projected content is placed in the footer (e.g. Save / Cancel buttons). With an
/// `uploadHandler`, pasted or dropped files are uploaded and replaced by the markdown it returns.
/// With `mentionSearch`, typing `@` opens a people picker at the caret (↑/↓, Enter or Tab inserts
/// `@[Name](user:<id>)`, Esc closes only the picker); `mentions` resolves existing tokens in Preview.
@Component({
  selector: 'tk-markdown-editor',
  imports: [CdkTextareaAutosize, MarkdownViewerComponent, KbdComponent, AvatarComponent],
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
        [attr.aria-autocomplete]="mentionSearch() ? 'list' : null"
        [attr.aria-haspopup]="mentionSearch() ? 'listbox' : null"
        [attr.aria-controls]="pickerOpen() ? pickerId : null"
        [attr.aria-activedescendant]="activeOptionId()"
        [value]="value()"
        (input)="onInput(textarea)"
        (click)="syncMention()"
        (keyup)="onKeyup($event)"
        (blur)="closePicker()"
        (keydown)="onKeydown($event)"
        (paste)="onPaste($event)"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      ></textarea>
    } @else {
      <div class="preview">
        @if (value().trim()) {
          <tk-markdown [source]="value()" [mentions]="previewMentions()" />
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
    <ng-template #mentionPicker>
      <div class="tk-popover mention-picker" data-testid="mention-picker">
        <div
          role="listbox"
          aria-label="People"
          [id]="pickerId"
          [attr.aria-busy]="searching()"
        >
          @for (candidate of candidates(); track candidate.id; let i = $index) {
            <div
              role="option"
              tabindex="-1"
              class="option"
              [id]="pickerId + '-' + i"
              [class.active]="i === activeIndex()"
              [attr.aria-selected]="i === activeIndex()"
              [attr.data-testid]="'mention-option-' + candidate.email"
              (mouseenter)="activeIndex.set(i)"
              (mousedown)="$event.preventDefault()"
              (click)="choose(candidate)"
              (keydown.enter)="choose(candidate)"
            >
              <tk-avatar
                [userId]="candidate.id"
                [name]="candidate.displayName"
                [size]="20"
                [showTitle]="false"
              />
              <span class="name">{{ candidate.displayName }}</span>
              <span class="email">{{ candidate.email }}</span>
            </div>
          } @empty {
            <div class="empty" role="status">
              {{ searching() ? 'Searching…' : 'No one matches' }}
            </div>
          }
        </div>
      </div>
    </ng-template>
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
    .mention-picker {
      width: 320px;
      padding: 4px;
    }
    .option {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border-radius: var(--tk-radius-sm);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
    }
    .option.active {
      background: var(--tk-bg-hover);
    }
    .name {
      flex: none;
      max-width: 60%;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--tk-text);
    }
    .email {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .empty {
      padding: 6px 8px;
      color: var(--tk-text-subtle);
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
  /// People search for the `@` picker; null turns mentions off (fields where they mean nothing, D-95).
  readonly mentionSearch = input<MentionSearch | null>(null);
  /// Users already mentioned in the text, so Preview shows their tokens as chips.
  readonly mentions = input<readonly MentionUser[] | null | undefined>(null);

  readonly submitted = output<string>();
  readonly cancelled = output<void>();

  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly uploading = signal(0);
  protected readonly dragging = signal(false);
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('textarea');

  protected readonly pickerId = `tk-mention-picker-${nextEditorId++}`;
  protected readonly pickerOpen = signal(false);
  protected readonly candidates = signal<readonly MentionCandidate[]>([]);
  protected readonly searching = signal(false);
  protected readonly activeIndex = signal(0);
  protected readonly activeOptionId = computed(() =>
    this.pickerOpen() && this.candidates().length > 0
      ? `${this.pickerId}-${this.activeIndex()}`
      : null,
  );
  private readonly picked = signal<ReadonlyMap<string, MentionUser>>(new Map());
  protected readonly previewMentions = computed(() => [
    ...(this.mentions() ?? []),
    ...this.picked().values(),
  ]);

  private readonly pickerTemplate = viewChild.required<TemplateRef<unknown>>('mentionPicker');
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly injector = inject(Injector);
  private overlayRef: OverlayRef | null = null;
  private position: FlexibleConnectedPositionStrategy | null = null;
  private query: MentionQuery | null = null;
  private suppressedAt: number | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchAbort: AbortController | null = null;

  constructor() {
    effect(() => {
      if (this.mode() !== 'write' || !this.mentionSearch()) untracked(() => this.closePicker());
    });
    inject(DestroyRef).onDestroy(() => this.closePicker());
  }

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
    if (this.pickerOpen() && this.onPickerKeydown(event)) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.closePicker();
      this.submitted.emit(this.value());
    } else if (event.key === 'Escape') {
      this.cancelled.emit();
    }
  }

  protected onInput(textarea: HTMLTextAreaElement): void {
    this.value.set(textarea.value);
    this.syncMention();
  }

  protected onKeyup(event: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
      this.syncMention();
  }

  /// Opens, updates or closes the picker for the `@query` before the caret.
  protected syncMention(): void {
    const search = this.mentionSearch();
    const textarea = this.textarea()?.nativeElement;
    if (!search || !textarea || textarea.selectionStart !== textarea.selectionEnd) {
      this.closePicker();
      return;
    }
    const found = findMentionQuery(textarea.value, textarea.selectionStart);
    if (found?.start !== this.suppressedAt) this.suppressedAt = null;
    if (!found || this.suppressedAt !== null) {
      this.closePicker();
      return;
    }
    const previous = this.query;
    this.query = found;
    this.openPicker(textarea, found.start, previous?.start !== found.start);
    if (previous?.start !== found.start || previous.query !== found.query)
      this.scheduleSearch(search, found.query);
  }

  /// Replaces the typed `@query` with the candidate's mention token.
  protected choose(candidate: MentionCandidate): void {
    const textarea = this.textarea()?.nativeElement;
    const query = this.query;
    if (!textarea || !query) return;
    const next = insertMention(textarea.value, query, candidate);
    textarea.value = next.text;
    textarea.setSelectionRange(next.caret, next.caret);
    this.value.set(next.text);
    this.picked.update((map) => new Map(map).set(candidate.id.toLowerCase(), candidate));
    this.closePicker();
    textarea.focus();
    afterNextRender(() => textarea.setSelectionRange(next.caret, next.caret), {
      injector: this.injector,
    });
  }

  protected closePicker(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchAbort?.abort();
    this.searchAbort = null;
    const overlayRef = this.overlayRef;
    this.overlayRef = null;
    this.position = null;
    overlayRef?.dispose();
    this.query = null;
    this.pickerOpen.set(false);
    this.candidates.set([]);
    this.searching.set(false);
    this.activeIndex.set(0);
  }

  /// Arrows move, Enter / Tab insert, Esc closes the picker only. With nothing to pick, Enter and Tab
  /// close the picker and keep their usual meaning; modified keys (Ctrl/⌘+Enter) pass through.
  private onPickerKeydown(event: KeyboardEvent): boolean {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const count = this.candidates().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (count === 0) return false;
        event.preventDefault();
        this.activeIndex.set(
          (this.activeIndex() + (event.key === 'ArrowDown' ? 1 : -1) + count) % count,
        );
        return true;
      case 'Enter':
      case 'Tab': {
        if (event.shiftKey) return false;
        const candidate = this.candidates()[this.activeIndex()];
        if (!candidate) {
          this.suppress();
          return false;
        }
        event.preventDefault();
        this.choose(candidate);
        return true;
      }
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.suppress();
        return true;
    }
    return false;
  }

  private suppress(): void {
    this.suppressedAt = this.query?.start ?? null;
    this.closePicker();
  }

  private openPicker(textarea: HTMLTextAreaElement, at: number, moved: boolean): void {
    if (this.overlayRef && !moved) return;
    const caret = caretPosition(textarea, at);
    const origin = { x: caret.x, y: caret.y, height: caret.height };
    if (this.overlayRef && this.position) {
      this.position.setOrigin(origin);
      this.overlayRef.updatePosition();
      return;
    }
    this.position = createFlexibleConnectedPositionStrategy(this.injector, origin)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
      ])
      .withPush(true)
      .withViewportMargin(8);
    this.overlayRef = createOverlayRef(this.injector, {
      positionStrategy: this.position,
      scrollStrategy: createCloseScrollStrategy(this.injector),
    });
    this.overlayRef.attach(new TemplatePortal(this.pickerTemplate(), this.viewContainer));
    this.overlayRef.detachments().subscribe(() => {
      if (this.overlayRef) this.closePicker();
    });
    this.pickerOpen.set(true);
  }

  private scheduleSearch(search: MentionSearch, query: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.searchAbort = null;
    this.searching.set(true);
    this.searchTimer = setTimeout(() => void this.runSearch(search, query), MENTION_DEBOUNCE_MS);
  }

  private async runSearch(search: MentionSearch, query: string): Promise<void> {
    this.searchTimer = null;
    const abort = new AbortController();
    this.searchAbort = abort;
    let found: readonly MentionCandidate[] = [];
    try {
      found = await search(query.trim(), abort.signal);
    } catch {
      found = [];
    }
    if (abort.signal.aborted) return;
    this.searchAbort = null;
    this.searching.set(false);
    this.candidates.set(found.slice(0, MENTION_ROWS));
    this.activeIndex.set(0);
    if (found.length === 0 && /\s/.test(query)) this.suppress();
  }
}
