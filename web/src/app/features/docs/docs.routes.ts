import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { DOCS_DOC_VIEW, DOCS_HOME_VIEW, DOCS_LAYOUT_VIEW, DOCS_TRASH_VIEW } from './docs.views';

/// `/projects/:projectKey/docs`: the tree layout around the home, the trash and one doc
/// (`:docKey/:slug`, the slug cosmetic and replaced when stale or missing).
export default [
  viewRoute(DOCS_LAYOUT_VIEW, {
    path: '',
    children: [
      viewRoute(DOCS_HOME_VIEW, { path: '' }),
      viewRoute(DOCS_TRASH_VIEW, {
        path: 'trash',
        title: 'Docs trash',
        data: { breadcrumb: 'Trash' },
      }),
      viewRoute(DOCS_DOC_VIEW, { path: ':docKey' }),
      viewRoute(DOCS_DOC_VIEW, { path: ':docKey/:slug' }),
    ],
  }),
] satisfies Routes;
