import { Routes } from '@angular/router';
import { provideDocPageSection } from '@core/docs/doc-extensions';
import { viewRoute } from '@core/views/view-registry';
import { provideDocsDiagrams } from './diagram/docs-diagrams.providers';
import { DOCS_DOC_VIEW, DOCS_HOME_VIEW, DOCS_LAYOUT_VIEW, DOCS_TRASH_VIEW } from './docs.views';
import { provideDocLinks } from './page/links/doc-links.providers';
import { provideDocMentions } from './page/mentions/doc-mentions.providers';

/// `/projects/:projectKey/docs`: the tree layout around the home, the trash and one doc
/// (`:docKey/:slug`, the slug cosmetic and replaced when stale or missing). Page sections,
/// markdown enhancers and editor plugins of Docs stories are provided here.
export default [
  viewRoute(DOCS_LAYOUT_VIEW, {
    path: '',
    providers: [
      ...provideDocLinks(),
      ...provideDocMentions(),
      provideDocPageSection({
        id: 'attachments',
        order: 50,
        placement: 'footer',
        kinds: ['Page'],
        loadComponent: () =>
          import('./page/attachments/doc-attachments-section.component').then(
            (m) => m.DocAttachmentsSectionComponent,
          ),
      }),
      provideDocPageSection({
        id: 'comments',
        order: 90,
        placement: 'footer',
        kinds: ['Page', 'Diagram'],
        loadComponent: () =>
          import('./page/comments/doc-comments-section.component').then(
            (m) => m.DocCommentsSectionComponent,
          ),
      }),
      provideDocsDiagrams(),
    ],
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
