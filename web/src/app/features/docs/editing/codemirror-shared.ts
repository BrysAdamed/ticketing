import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/// Replaces the whole document (for example after "Keep editing on latest") without an undo step
/// back to the old text.
export function replaceDocument(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: EditorSelection.cursor(Math.min(view.state.selection.main.head, text.length)),
    annotations: Transaction.addToHistory.of(false),
  });
}

/// The look of the docs source editors (markdown and Mermaid), from the design tokens.
export const sourceEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--tk-text)',
    backgroundColor: 'var(--tk-bg)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--tk-font-mono)',
    lineHeight: '20px',
    overflow: 'auto',
  },
  '.cm-content': { padding: '16px 0 48px', caretColor: 'var(--tk-text)' },
  '.cm-line': { padding: '0 20px 0 24px' },
  '.cm-activeLine': { backgroundColor: 'var(--tk-bg-hover)' },
  '.cm-tk-fence': { backgroundColor: 'var(--tk-bg-subtle)' },
  '.cm-tk-fence.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--tk-accent) 8%, var(--tk-bg-subtle))',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--tk-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: 'color-mix(in srgb, var(--tk-accent) 22%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--tk-accent-subtle)' },
  '.cm-placeholder': { color: 'var(--tk-text-subtle)' },
  '.cm-searchMatch': { backgroundColor: 'var(--tk-warning-bg)' },
  '.cm-panels': {
    backgroundColor: 'var(--tk-bg-subtle)',
    color: 'var(--tk-text)',
    borderColor: 'var(--tk-border)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--tk-border)',
    borderRadius: 'var(--tk-radius-lg)',
    backgroundColor: 'var(--tk-surface-raised)',
    boxShadow: 'var(--tk-shadow-md)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--tk-font-sans)',
    fontSize: 'var(--tk-text-base)',
    minWidth: '240px',
    padding: '4px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 8px',
    borderRadius: 'var(--tk-radius-md)',
    color: 'var(--tk-text)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--tk-bg-hover)',
    color: 'var(--tk-text)',
  },
  '.cm-completionDetail': {
    marginLeft: 'auto',
    paddingLeft: '16px',
    color: 'var(--tk-text-subtle)',
    fontStyle: 'normal',
    fontSize: 'var(--tk-text-sm)',
  },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
});
