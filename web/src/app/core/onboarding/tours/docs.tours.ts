import { TourDefinition } from '../engine/tour.model';

/// Tour of a project's Docs home (spec 14.4, D-177): the tree (its rail while it is hidden), the
/// tree filter, creating docs, Recently updated (the empty state in its place) and the trash.
/// Writers get the New step, Owners the trash; Viewers get three steps.
export const DOCS_HOME_TOUR: TourDefinition = {
  id: 'tour.docs.home',
  version: 1,
  viewId: 'docs.home',
  title: 'Docs',
  steps: [
    {
      id: 'tree',
      anchor: 'docs.tree',
      placement: 'end',
      title: 'The tree',
      body: 'Every page, folder and diagram of the project. J and K move, Enter opens, right-click or Shift F10 offers rename, move and delete; Ctrl \\ hides the tree.',
    },
    {
      id: 'filter',
      anchor: 'docs.filter',
      placement: 'end',
      title: 'Filter the tree',
      body: 'Type part of a title to narrow the tree; / jumps here. To search inside pages, open Search and switch it to Docs.',
    },
    {
      id: 'new',
      anchor: 'docs.new',
      requires: 'write',
      placement: 'below',
      title: 'Write a page',
      body: 'Pages are markdown, folders group them and diagrams are Mermaid or a canvas. N creates a page in the current folder; drag in the tree to move one.',
    },
    {
      id: 'recent',
      anchor: 'docs.recent',
      title: 'Recently updated',
      body: 'The pages and diagrams changed last, with who changed them. Once there are docs, they show up here.',
    },
    {
      id: 'trash',
      anchor: 'docs.trash',
      requires: 'owner',
      placement: 'end',
      title: 'Trash',
      body: 'Deleted docs wait here with the folder they came from, who deleted them and when. Restore puts them back where they were.',
    },
  ],
};

/// Tour of one open page or diagram (spec 14.4, D-177): the page bar, Watch, Edit, export and
/// links, and the comments. Viewers get no Edit step. A folder only has the bar and export, and the
/// editor (`?mode=edit`) and the history replace the bar, so the tour is meant for the read view.
export const DOCS_DOC_TOUR: TourDefinition = {
  id: 'tour.docs.doc',
  version: 1,
  viewId: 'docs.doc',
  title: 'Doc',
  steps: [
    {
      id: 'bar',
      anchor: 'docs.bar',
      placement: 'below',
      title: 'Where it lives',
      body: 'The folders above the doc, who edited it last and its version. The version, or H, opens the history: compare any two versions and restore one.',
    },
    {
      id: 'watch',
      anchor: 'docs.watch',
      placement: 'below',
      title: 'Watch',
      body: 'Watch a page, or press W, to be notified of new versions and comments. Being mentioned makes you a watcher too.',
    },
    {
      id: 'edit',
      anchor: 'docs.edit',
      requires: 'write',
      placement: 'below',
      title: 'Edit',
      body: 'E opens the editor. Type [[ to link a doc, # a ticket and @ to mention someone; Ctrl S publishes a new version, and your draft is kept until then.',
    },
    {
      id: 'share',
      anchor: 'docs.share',
      placement: 'below',
      title: 'Export and share',
      body: 'Export the doc as a PDF (Ctrl P) or copy its link (Ctrl Shift .). Ctrl . copies its key, such as WEB-D-12, to paste into a ticket or another page.',
    },
    {
      id: 'comments',
      anchor: 'docs.comments',
      placement: 'above',
      title: 'Comments',
      body: 'Discuss the page here; @ mentions someone who can read the project. Shift C jumps to the comment box.',
    },
  ],
};
