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
/// injectable). Later stories swap these: the page reader and editor (TKT-14), Mermaid and Canvas
/// diagrams (TKT-17, TKT-18).
export const DOCS_PAGE_VIEW = defineView({
  viewId: 'docs.page',
  variants: { default: () => import('./doc/page-content.view').then((m) => m.PageContentView) },
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
