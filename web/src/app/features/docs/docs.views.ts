import { DiagramFormat, Doc, DocKind } from '@core/docs/doc.models';
import { defineView, ViewDefinition } from '@core/views/view-definition';

export const DOCS_LAYOUT_VIEW = defineView({
  viewId: 'docs.layout',
  variants: { default: () => import('./layout/docs-layout.view').then((m) => m.DocsLayoutView) },
});

export const DOCS_HOME_VIEW = defineView({
  viewId: 'docs.home',
  variants: { default: () => import('./home/docs-home.view').then((m) => m.DocsHomeView) },
});

export const DOCS_TRASH_VIEW = defineView({
  viewId: 'docs.trash',
  variants: { default: () => import('./trash/docs-trash.view').then((m) => m.DocsTrashView) },
});

/// The routed frame of one doc (`/projects/:projectKey/docs/:docKey/:slug`): loads it, keeps the
/// URL slug and the tree in sync and renders the page bar, then the content view for its kind.
export const DOCS_DOC_VIEW = defineView({
  viewId: 'docs.doc',
  variants: { default: () => import('./doc/doc.view').then((m) => m.DocView) },
});

/// Content views by kind, rendered inside the doc frame with the input `doc` (and `DocStore`
/// injectable). `?mode=edit` switches a page or diagram to its editor.
export const DOCS_PAGE_VIEW = defineView({
  viewId: 'docs.page',
  variants: { default: () => import('./page/page.view').then((m) => m.PageView) },
});

/// The page editor (CodeMirror split view), a lazy chunk the page view renders for `?mode=edit`.
export const DOCS_PAGE_EDIT_VIEW = defineView({
  viewId: 'docs.page.edit',
  variants: {
    default: () => import('./page/editor/page-editor.view').then((m) => m.PageEditorView),
  },
});

/// A diagram of any format: the rendered diagram with zoom and fit, or, for `?mode=edit`, the
/// editor of its format from `DIAGRAM_EDIT_VIEWS`.
export const DOCS_DIAGRAM_VIEW = defineView({
  viewId: 'docs.diagram',
  variants: {
    default: () => import('./diagram/diagram.view').then((m) => m.DiagramView),
  },
});

/// The Mermaid source editor with a live preview, a lazy chunk with CodeMirror.
export const DOCS_DIAGRAM_MERMAID_EDIT_VIEW = defineView({
  viewId: 'docs.diagram.mermaid.edit',
  variants: {
    default: () => import('./diagram/mermaid/mermaid-editor.view').then((m) => m.MermaidEditorView),
  },
});

export const DOCS_FOLDER_VIEW = defineView({
  viewId: 'docs.folder',
  variants: {
    default: () => import('./doc/folder-content.view').then((m) => m.FolderContentView),
  },
});

export const DOC_CONTENT_VIEWS: Readonly<Record<DocKind, ViewDefinition>> = {
  Folder: DOCS_FOLDER_VIEW,
  Page: DOCS_PAGE_VIEW,
  Diagram: DOCS_DIAGRAM_VIEW,
};

/// The editor of each diagram format, rendered by `docs.diagram` for `?mode=edit` with the input
/// `doc`. A format without one is read-only (no Edit); Canvas (TKT-18) adds its editor here.
export const DIAGRAM_EDIT_VIEWS: Readonly<Partial<Record<DiagramFormat, ViewDefinition>>> = {
  Mermaid: DOCS_DIAGRAM_MERMAID_EDIT_VIEW,
};

/// Whether the content view of `doc` renders an editor for `?mode=edit`: pages, and diagrams whose
/// format has one. The frame offers Edit (`E`) and hides its page bar only for these.
export function hasDocEditor(doc: Pick<Doc, 'kind' | 'diagramFormat'>): boolean {
  if (doc.kind === 'Page') return true;
  return doc.kind === 'Diagram' && !!doc.diagramFormat && !!DIAGRAM_EDIT_VIEWS[doc.diagramFormat];
}
