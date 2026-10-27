import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  StreamLanguage,
  StringStream,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
  ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { sourceEditorTheme } from './codemirror-shared';

export interface MermaidEditorOptions {
  parent: HTMLElement;
  doc: string;
  placeholder: string;
  onChange(text: string): void;
  onBlur(): void;
}

const DIAGRAM_KEYWORDS =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|mindmap|pie|journey|timeline|gitGraph|quadrantChart|requirementDiagram|C4Context|sankey-beta|xychart-beta|block-beta)\b/;
const STATEMENT_KEYWORDS =
  /^(subgraph|end|direction|participant|actor|activate|deactivate|note|loop|alt|else|opt|par|and|critical|break|rect|autonumber|class|classDef|style|linkStyle|click|state|section|title|dateFormat|axisFormat|excludes|todayMarker|root|accTitle|accDescr)\b/;
const ARROW =
  /^(<?[-=.]{1,3}(>>|>|x|o|\)|\|)?|<<?[-.]+|\|\|--|\}o--|\|o--|--o\{|--\|\{|--\|\||o\{|\}\|)/;

const mermaidLanguage = StreamLanguage.define<{ start: boolean }>({
  name: 'mermaid',
  startState: () => ({ start: true }),
  token(stream: StringStream, state) {
    if (stream.sol()) state.start = true;
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"[^"]*"?/)) return 'string';
    const first = state.start;
    state.start = false;
    if (first && stream.match(DIAGRAM_KEYWORDS)) return 'keyword';
    if (first && stream.match(STATEMENT_KEYWORDS)) return 'controlKeyword';
    if (stream.match(ARROW)) return 'operator';
    if (stream.match(/^[[\](){}|:;,]/)) return 'punctuation';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    stream.next();
    stream.eatWhile(/[^\s"[\](){}|:;,%<>=.-]/);
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
});

const mermaidHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--tk-violet-fg)', fontWeight: '600' },
  { tag: tags.controlKeyword, color: 'var(--tk-blue-fg)' },
  { tag: tags.operator, color: 'var(--tk-orange-fg)' },
  { tag: tags.string, color: 'var(--tk-green-fg)' },
  { tag: tags.number, color: 'var(--tk-cyan-fg)' },
  { tag: tags.punctuation, color: 'var(--tk-text-subtle)' },
  { tag: tags.comment, color: 'var(--tk-text-subtle)', fontStyle: 'italic' },
]);

/// The Mermaid source pane of the diagram editor (CodeMirror 6, in the editor's lazy chunk): line
/// numbers (parser errors name the line), token colours for diagram keywords, arrows, strings and
/// `%%` comments, history and search. `Mod-s`, `Mod-Enter` and `Escape` are left to the app's
/// ShortcutService.
export function createMermaidEditor(options: MermaidEditorOptions): EditorView {
  return new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorState.allowMultipleSelections.of(false),
        EditorState.tabSize.of(2),
        mermaidLanguage,
        syntaxHighlighting(mermaidHighlight),
        placeholder(options.placeholder),
        keymap.of([
          ...defaultKeymap.filter((binding) => binding.key !== 'Mod-Enter'),
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({ blur: () => options.onBlur() }),
        sourceEditorTheme,
        EditorView.theme({
          '.cm-gutters': {
            backgroundColor: 'var(--tk-bg)',
            color: 'var(--tk-text-disabled)',
            border: 'none',
          },
          '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px', minWidth: '28px' },
          '.cm-line': { padding: '0 20px 0 8px' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--tk-bg-hover)' },
        }),
      ],
    }),
  });
}
