import { TourDefinition } from '../engine/tour.model';

/// Tour of search (spec 6.8, 14.4): Tickets or Docs, the text box, filters, sort, results and CSV
/// export. Read-only, so everyone gets every step. Both scopes expose the same anchors except
/// export, which the Docs scope has not, so the copy covers both (D-176). The results step points
/// at the list or, with nothing found, at the empty state in its place.
export const SEARCH_TOUR: TourDefinition = {
  id: 'tour.search.results',
  version: 2,
  viewId: 'search.results',
  title: 'Search',
  steps: [
    {
      id: 'scope',
      anchor: 'search.scope',
      placement: 'below',
      title: 'Tickets or docs',
      body: 'Search tickets, or docs: pages, folders and diagrams. The choice is part of the URL, so a link opens the same list.',
    },
    {
      id: 'text',
      anchor: 'search.text',
      title: 'Search every project',
      body: 'Type words from titles, descriptions or page content, or a key such as WEB-42 or WEB-D-12. It searches every project you can read; / jumps here from anywhere on this page.',
    },
    {
      id: 'filters',
      anchor: 'search.filters',
      title: 'Filters',
      body: 'Narrow tickets by project, type, status, assignee, labels, dates and more, docs by project, kind and last update. Every filter is kept in the URL, so a search can be bookmarked or shared.',
    },
    {
      id: 'sort',
      anchor: 'search.sort',
      placement: 'start',
      title: 'Sort',
      body: 'Tickets sort by last update, creation, priority, key or rank, with the arrow flipping the order; docs by relevance or last update.',
    },
    {
      id: 'results',
      anchor: 'search.results',
      placement: 'above',
      title: 'Results',
      body: 'J and K move through the results. Enter peeks at a ticket without leaving the page (Shift+Enter opens it in full) and opens a doc.',
    },
    {
      id: 'export',
      anchor: 'search.export',
      title: 'Export CSV',
      body: 'Download the ticket results, with these filters, as a CSV file of up to 10 000 rows.',
    },
  ],
};
