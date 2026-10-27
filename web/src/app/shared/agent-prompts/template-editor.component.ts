import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { caretPosition } from '../markdown/caret-position';
import {
  highlightIssues,
  insertPlaceholder,
  matchPlaceholders,
  placeholderQuery,
  TemplateIssue,
  TemplatePlaceholder,
  TemplateSegment,
} from './template-text';

let nextEditorId = 0;

/// Monospace template editor. Typing `{{` opens a completion list of `placeholders` at the caret
/// (↑/↓, Enter or Tab inserts `{{name}}`, Esc closes it). `issues` with a line and column are
/// underlined in place and listed below the text; clicking one moves the caret there. The textarea
/// grows with its content.
@Component({
  selector: 'tk-template-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.readonly]': 'readonly()', '[class.invalid]': 'positioned().length > 0' },
  template: `
    <div class="surface">
      <pre
        class="backdrop"
        aria-hidden="true"
      >@for (segment of backdrop(); track $index) {<span [class.issue]="!!segment.issue" [attr.data-testid]="segment.issue ? 'template-issue-mark' : null" [attr.title]="segment.issue?.message ?? null">{{ segment.text }}</span>}</pre>
      <textarea
        #textarea
        spellcheck="false"
        [id]="inputId"
        [readOnly]="readonly()"
        [value]="value()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-invalid]="positioned().length > 0"
        [attr.aria-describedby]="issues().length ? issuesId : null"
        [attr.aria-autocomplete]="readonly() ? null : 'list'"
        [attr.aria-controls]="completionOpen() ? listId : null"
        [attr.aria-activedescendant]="activeOptionId()"
        [attr.data-testid]="testId() + '-input'"
        (input)="onInput()"
        (click)="syncCompletion()"
        (keyup)="onKeyup($event)"
        (keydown)="onKeydown($event)"
        (blur)="closeCompletion()"
      ></textarea>
    </div>
    @if (completionOpen()) {
      <div
        class="tk-popover completion"
        role="listbox"
        aria-label="Placeholders"
        [id]="listId"
        [style.left.px]="completionAt().x"
        [style.top.px]="completionAt().y"
        [attr.data-testid]="testId() + '-completion'"
      >
        @for (placeholder of matches(); track placeholder.name; let i = $index) {
          <div
            role="option"
            class="option"
            [id]="listId + '-' + i"
            [class.active]="i === activeIndex()"
            [attr.aria-selected]="i === activeIndex()"
            [attr.data-testid]="testId() + '-option-' + placeholder.name"
            (mouseenter)="activeIndex.set(i)"
            (mousedown)="$event.preventDefault(); choose(placeholder)"
          >
            <code>{{ '{{' }}{{ placeholder.name }}{{ '}}' }}</code>
            <span class="description">{{ placeholder.description }}</span>
          </div>
        }
      </div>
    }
    @if (issues().length) {
      <ul class="issues" [id]="issuesId" [attr.data-testid]="testId() + '-issues'">
        @for (issue of issues(); track $index) {
          <li [attr.data-testid]="testId() + '-issue'">
            @if (issue.line !== null) {
              <button
                type="button"
                class="location"
                (click)="focusAt(issue.line, issue.column ?? 1)"
              >
                Line {{ issue.line }}{{ issue.column !== null ? ', column ' + issue.column : '' }}
              </button>
            }
            <span>{{ issue.message }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
    }
    .surface {
      position: relative;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
    }
    .surface:focus-within {
      border-color: var(--tk-accent);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
    }
    :host(.invalid) .surface {
      border-color: var(--tk-danger-border);
    }
    :host(.readonly) .surface {
      background: var(--tk-bg-subtle);
    }
    .backdrop,
    textarea {
      box-sizing: border-box;
      width: 100%;
      margin: 0;
      padding: 10px 12px;
      border: 0;
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      line-height: 20px;
      letter-spacing: normal;
      tab-size: 2;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      overflow: hidden;
      color: transparent;
      pointer-events: none;
    }
    .backdrop .issue {
      color: transparent;
      background: var(--tk-danger-bg);
      border-radius: 2px;
      text-decoration: underline wavy var(--tk-danger-fg);
      text-decoration-skip-ink: none;
      text-underline-offset: 3px;
    }
    textarea {
      position: relative;
      display: block;
      min-height: 320px;
      resize: none;
      overflow: hidden;
      background: transparent;
      color: var(--tk-text);
      caret-color: var(--tk-text);
      outline: none;
    }
    .completion {
      position: absolute;
      z-index: 10;
      width: 360px;
      max-height: 260px;
      overflow: auto;
      padding: 4px;
    }
    .option {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 8px;
      border-radius: var(--tk-radius-sm);
      cursor: pointer;
    }
    .option.active {
      background: var(--tk-accent-subtle);
    }
    .option code {
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      color: var(--tk-text);
    }
    .description {
      font-size: var(--tk-text-xs);
      color: var(--tk-text-muted);
    }
    .issues {
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-danger-fg);
    }
    .issues li {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .location {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: var(--tk-weight-medium);
      text-decoration: underline;
      cursor: pointer;
      white-space: nowrap;
    }
  `,
})
export class TemplateEditorComponent {
  private readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly value = model<string>('');
  readonly placeholders = input<readonly TemplatePlaceholder[]>([]);
  readonly issues = input<readonly TemplateIssue[]>([]);
  readonly readonly = input(false);
  readonly ariaLabel = input('Template');
  readonly testId = input('template-editor');

  private readonly id = nextEditorId++;
  protected readonly inputId = `tk-template-editor-${this.id}`;
  protected readonly listId = `tk-template-completion-${this.id}`;
  protected readonly issuesId = `tk-template-issues-${this.id}`;

  protected readonly positioned = computed(() => this.issues().filter((i) => i.line !== null));
  protected readonly backdrop = computed<TemplateSegment[]>(() => [
    ...highlightIssues(this.value(), this.positioned()).flatMap((line, index) =>
      index === 0 ? line : [{ text: '\n', issue: null }, ...line],
    ),
    { text: '\n ', issue: null },
  ]);

  private readonly query = signal<{ start: number; query: string } | null>(null);
  protected readonly matches = computed(() => {
    const query = this.query();
    return query ? matchPlaceholders(this.placeholders(), query.query) : [];
  });
  protected readonly completionOpen = computed(() => this.matches().length > 0);
  protected readonly completionAt = signal({ x: 0, y: 0 });
  protected readonly activeIndex = signal(0);
  protected readonly activeOptionId = computed(() =>
    this.completionOpen() ? `${this.listId}-${this.activeIndex()}` : null,
  );

  constructor() {
    afterRenderEffect(() => {
      this.value();
      this.autosize();
    });
  }

  /// Moves the caret to a 1-based line and column and focuses the editor.
  focusAt(line: number, column: number): void {
    const element = this.textarea().nativeElement;
    const lines = element.value.split('\n');
    const row = Math.min(Math.max(line, 1), lines.length);
    const offset =
      lines.slice(0, row - 1).reduce((sum, l) => sum + l.length + 1, 0) +
      Math.min(Math.max(column - 1, 0), lines[row - 1].length);
    element.focus();
    element.setSelectionRange(offset, offset);
  }

  protected onInput(): void {
    this.value.set(this.textarea().nativeElement.value);
    this.syncCompletion();
  }

  protected onKeyup(event: KeyboardEvent): void {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) this.syncCompletion();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.completionOpen()) return;
    const count = this.matches().length;
    switch (event.key) {
      case 'ArrowDown':
        this.activeIndex.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        this.activeIndex.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter':
      case 'Tab':
        this.choose(this.matches()[this.activeIndex()]);
        break;
      case 'Escape':
        this.closeCompletion();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  protected syncCompletion(): void {
    const element = this.textarea().nativeElement;
    if (this.readonly() || element.selectionStart !== element.selectionEnd) {
      this.closeCompletion();
      return;
    }
    const query = placeholderQuery(element.value, element.selectionStart);
    if (query?.query !== this.query()?.query) this.activeIndex.set(0);
    this.query.set(query);
    if (!query) return;
    const caret = caretPosition(element, query.start);
    const box = this.host.nativeElement.getBoundingClientRect();
    this.completionAt.set({ x: caret.x - box.left, y: caret.y - box.top + caret.height + 2 });
  }

  protected closeCompletion(): void {
    this.query.set(null);
  }

  protected choose(placeholder: TemplatePlaceholder): void {
    const query = this.query();
    if (!query) return;
    const element = this.textarea().nativeElement;
    const result = insertPlaceholder(
      element.value,
      query.start,
      element.selectionStart,
      placeholder.name,
    );
    element.value = result.text;
    element.setSelectionRange(result.caret, result.caret);
    this.value.set(result.text);
    this.closeCompletion();
  }

  private autosize(): void {
    const element = this.textarea().nativeElement;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }
}
