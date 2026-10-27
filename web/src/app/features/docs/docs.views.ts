import { DocKind } from '@core/docs/doc.models';
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
/// injectable). `?mode=edit` switches a page or diagram to its editor. Mermaid and Canvas diagrams
/// (TKT-17, TKT-18) replace the diagram placeholder.
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

export const DOCS_DIAGRAM_VIEW = defineView({
  viewId: 'docs.diagram',
  variants: {
    default: () => import('./doc/diagram-content.view').then((m) => m.DiagramContentView),
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
