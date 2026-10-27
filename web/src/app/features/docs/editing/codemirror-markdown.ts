import {
  autocompletion,
  closeCompletion,
  Completion,
  CompletionContext,
  completionKeymap,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  LanguageSupport,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import {
  EditorSelection,
  EditorState,
  Extension,
  Facet,
  Prec,
  RangeSetBuilder,
} from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { sourceEditorTheme } from './codemirror-shared';

/// A command of the `/` menu typed at the start of a line.
export interface SlashCommand {
  id: string;
  label: string;
  hint?: string;
  run(view: EditorView): void;
}

/// Completion sources that editor plugins add (for example `[[` doc links), as
/// `markdownCompletions.of(source)` in their extensions. The editor's own `autocompletion` config
/// overrides language-data sources, so this facet is the way in; the first source with a result wins.
export const markdownCompletions = Facet.define<CompletionSource>();

export interface MarkdownEditorOptions {
  parent: HTMLElement;
  doc: string;
  placeholder: string;
  slashCommands: () => readonly SlashCommand[];
  extraExtensions: readonly Extension[];
  onChange(text: string): void;
  onBlur(): void;
  onScroll(view: EditorView): void;
  /// Files pasted or dropped at `position`; return true when they were taken.
  onFiles(files: File[], position: number): boolean;
}

/// The markdown source pane of the page editor (CodeMirror 6, loaded as a lazy chunk with the
/// editor): markdown syntax with token colours, history, search, list continuation, `/` slash
/// commands, paste/drop of files, and `Mod-b`/`Mod-i`/`Mod-k` formatting. `Mod-s`, `Mod-Enter`
/// and `Escape` are left to the app's ShortcutService (publish, publish and close, close).
export function createMarkdownEditor(options: MarkdownEditorOptions): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(false),
        new LanguageSupport(markdownLanguage),
        Prec.high(keymap.of(markdownKeymap)),
        syntaxHighlighting(markdownHighlight),
        fenceBand,
        placeholder(options.placeholder),
        autocompletion({
          override: [slashSource(options.slashCommands), pluginCompletions],
          icons: false,
          activateOnTyping: true,
        }),
        Prec.high(
          keymap.of([
            { key: 'Mod-b', run: (view) => wrap(view, '**', '**', 'bold text') },
            { key: 'Mod-i', run: (view) => wrap(view, '_', '_', 'italic text') },
            { key: 'Mod-k', run: (view) => wrap(view, '[', '](https://)', 'link text') },
          ]),
        ),
        keymap.of([
          ...completionKeymap,
          ...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'),
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          blur: () => options.onBlur(),
          scroll: (_event, view) => options.onScroll(view),
          paste: (event, view) => {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return false;
            if (!options.onFiles(files, view.state.selection.main.head)) return false;
            event.preventDefault();
            return true;
          },
          drop: (event, view) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            const position =
              view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
              view.state.selection.main.head;
            if (!options.onFiles(files, position)) return false;
            event.preventDefault();
            return true;
          },
        }),
        sourceEditorTheme,
        ...options.extraExtensions,
      ],
    }),
  });
}

/// Replaces the selection with `text`; `select` (relative to the insert) is selected afterwards,
/// otherwise the caret goes to the end of the insert.
export function replaceSelection(
  view: EditorView,
  text: string,
  select?: { from: number; to: number },
): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: select
      ? EditorSelection.range(from + select.from, from + select.to)
      : EditorSelection.cursor(from + text.length),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/// Inserts `text` as its own block after the current line, with blank lines around; the caret
/// goes to `caret` (an offset in `text`, default its end).
export function insertBlock(view: EditorView, text: string, caret = text.length): void {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const blank = line.text.trim() === '';
  const insertAt = blank ? line.from : line.to;
  const before = blank ? '' : '\n\n';
  const nextLine = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : null;
  const after = nextLine && nextLine.text.trim() !== '' ? '\n\n' : blank ? '' : '\n';
  const insert = `${before}${text}${after}`;
  view.dispatch({
    changes: { from: insertAt, to: blank ? line.to : insertAt, insert },
    selection: EditorSelection.cursor(insertAt + before.length + caret),
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
}

/// Wraps the selection in `before`/`after`, or inserts `placeholderText` wrapped and selected.
export function wrap(view: EditorView, before: string, after: string, placeholderText: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const inner = selected || placeholderText;
  replaceSelection(view, `${before}${inner}${after}`, {
    from: before.length,
    to: before.length + inner.length,
  });
  return true;
}

/// Prefixes every selected line with `prefix` (lists, task lists, headings, quotes).
export function prefixLines(view: EditorView, prefix: (index: number) => string): void {
  const { from, to } = view.state.selection.main;
  const first = view.state.doc.lineAt(from);
  const last = view.state.doc.lineAt(to);
  const changes = [];
  for (let n = first.number, i = 0; n <= last.number; n++, i++) {
    changes.push({ from: view.state.doc.line(n).from, insert: prefix(i) });
  }
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
  view.focus();
}

/// The 0-based line at the top of the source pane.
export function topLine(view: EditorView): number {
  const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
  return view.state.doc.lineAt(block.from).number - 1;
}

async function pluginCompletions(context: CompletionContext): Promise<CompletionResult | null> {
  for (const source of context.state.facet(markdownCompletions)) {
    const result = await source(context);
    if (result) return result;
  }
  return null;
}

function slashSource(commands: () => readonly SlashCommand[]) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const match = /^\s*\/([\w-]*)$/.exec(before);
    if (!match) return null;
    const slash = line.from + before.lastIndexOf('/');
    return {
      from: slash + 1,
      validFor: /^[\w-]*$/,
      options: commands().map((command): Completion => ({
        label: command.label,
        detail: command.hint,
        type: 'text',
        apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
          view.dispatch({ changes: { from: slash, to, insert: '' } });
          closeCompletion(view);
          command.run(view);
        },
      })),
    };
  };
}

const markdownHighlight = HighlightStyle.define([
  {
    tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    fontWeight: '600',
  },
  { tag: tags.heading1, fontSize: '15px' },
  { tag: tags.processingInstruction, color: 'var(--tk-text-subtle)' },
  { tag: [tags.link, tags.url], color: 'var(--tk-accent-fg)' },
  { tag: tags.labelName, color: 'var(--tk-violet-fg)' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--tk-pink-fg)' },
  { tag: tags.quote, color: 'var(--tk-text-muted)' },
  { tag: tags.contentSeparator, color: 'var(--tk-text-subtle)' },
  { tag: tags.comment, color: 'var(--tk-text-subtle)' },
]);

const fenceLine = Decoration.line({ class: 'cm-tk-fence' });

function fenceDecorations(view: EditorView): DecorationSet {
  const starts = new Set<number>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'FencedCode') return true;
        for (let pos = Math.max(node.from, from); pos <= Math.min(node.to, to);) {
          const line = view.state.doc.lineAt(pos);
          starts.add(line.from);
          pos = line.to + 1;
        }
        return false;
      },
    });
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const start of [...starts].sort((a, b) => a - b)) builder.add(start, start, fenceLine);
  return builder.finish();
}

const fenceBand = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = fenceDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = fenceDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
