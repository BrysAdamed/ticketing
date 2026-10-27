import { EditorView } from '@codemirror/view';
import { insertBlock, prefixLines, wrap } from '../../editing/codemirror-markdown';

/// A built-in formatting action of the page editor (toolbar and/or `/` menu).
export interface EditorAction {
  id: string;
  label: string;
  icon: string;
  hint?: string;
  /// Keyboard shortcut handled inside CodeMirror, shown in the tooltip.
  keys?: string;
  toolbar: boolean;
  slash: boolean;
  run(view: EditorView): void;
}

const TABLE = '| Column | Column |\n| --- | --- |\n|  |  |';

/// Formatting of spec 1.8 (heading, bold, italic, link, lists, task list, code block, table,
/// callout); image upload is handled by the editor view because it opens a file picker.
export const EDITOR_ACTIONS: readonly EditorAction[] = [
  {
    id: 'heading',
    label: 'Heading',
    icon: 'tablerHeading',
    hint: '##',
    toolbar: true,
    slash: false,
    run: (view) => prefixLines(view, () => '## '),
  },
  {
    id: 'h1',
    label: 'Heading 1',
    icon: 'tablerH1',
    hint: '#',
    toolbar: false,
    slash: true,
    run: (view) => prefixLines(view, () => '# '),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    icon: 'tablerH2',
    hint: '##',
    toolbar: false,
    slash: true,
    run: (view) => prefixLines(view, () => '## '),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    icon: 'tablerH3',
    hint: '###',
    toolbar: false,
    slash: true,
    run: (view) => prefixLines(view, () => '### '),
  },
  {
    id: 'bold',
    label: 'Bold',
    icon: 'tablerBold',
    keys: 'mod+b',
    toolbar: true,
    slash: false,
    run: (view) => wrap(view, '**', '**', 'bold text'),
  },
  {
    id: 'italic',
    label: 'Italic',
    icon: 'tablerItalic',
    keys: 'mod+i',
    toolbar: true,
    slash: false,
    run: (view) => wrap(view, '_', '_', 'italic text'),
  },
  {
    id: 'code',
    label: 'Inline code',
    icon: 'tablerCode',
    toolbar: true,
    slash: false,
    run: (view) => wrap(view, '`', '`', 'code'),
  },
  {
    id: 'link',
    label: 'Link',
    icon: 'tablerLink',
    keys: 'mod+k',
    toolbar: true,
    slash: true,
    run: (view) => wrap(view, '[', '](https://)', 'link text'),
  },
  {
    id: 'bullets',
    label: 'Bulleted list',
    icon: 'tablerList',
    hint: '-',
    toolbar: true,
    slash: true,
    run: (view) => prefixLines(view, () => '- '),
  },
  {
    id: 'numbers',
    label: 'Numbered list',
    icon: 'tablerListNumbers',
    hint: '1.',
    toolbar: true,
    slash: true,
    run: (view) => prefixLines(view, (i) => `${i + 1}. `),
  },
  {
    id: 'tasks',
    label: 'Task list',
    icon: 'tablerListCheck',
    hint: '- [ ]',
    toolbar: true,
    slash: true,
    run: (view) => prefixLines(view, () => '- [ ] '),
  },
  {
    id: 'codeblock',
    label: 'Code block',
    icon: 'tablerSourceCode',
    hint: '```',
    toolbar: true,
    slash: true,
    run: (view) => insertBlock(view, '```\n\n```', 4),
  },
  {
    id: 'table',
    label: 'Table',
    icon: 'tablerTable',
    toolbar: true,
    slash: true,
    run: (view) => insertBlock(view, TABLE, 2),
  },
  {
    id: 'callout',
    label: 'Callout',
    icon: 'tablerInfoSquareRounded',
    hint: '> [!NOTE]',
    toolbar: true,
    slash: true,
    run: (view) => insertBlock(view, '> [!NOTE]\n> '),
  },
  {
    id: 'warning',
    label: 'Warning callout',
    icon: 'tablerInfoSquareRounded',
    hint: '> [!WARNING]',
    toolbar: false,
    slash: true,
    run: (view) => insertBlock(view, '> [!WARNING]\n> '),
  },
  {
    id: 'quote',
    label: 'Quote',
    icon: 'tablerQuote',
    hint: '>',
    toolbar: false,
    slash: true,
    run: (view) => prefixLines(view, () => '> '),
  },
  {
    id: 'divider',
    label: 'Divider',
    icon: 'tablerSeparatorHorizontal',
    hint: '---',
    toolbar: false,
    slash: true,
    run: (view) => insertBlock(view, '---'),
  },
];
