import { TourDefinition } from '../engine/tour.model';

/// Tour of ticket search (spec 6.8, 14.4): the text box, filters, sort, results and CSV export.
/// Read-only, so everyone gets every step. The results step points at the list or, with nothing
/// found, at the empty state in its place. It covers the Tickets scope; Docs has its own box.
export const SEARCH_TOUR: TourDefinition = {
  id: 'tour.search.results',
  version: 1,
  viewId: 'search.results',
  title: 'Search',
  steps: [
    {
      id: 'text',
      anchor: 'search.text',
      title: 'Search every project',
      body: 'Type words from titles and descriptions, or a key such as WEB-42. It searches every project you can read; / jumps here from anywhere on this page.',
    },
    {
      id: 'filters',
      anchor: 'search.filters',
      title: 'Filters',
      body: 'Narrow by project, type, status, priority, assignee, labels, version, location or dates. Every filter is kept in the URL, so a search can be bookmarked or shared.',
    },
    {
      id: 'sort',
      anchor: 'search.sort',
      placement: 'start',
      title: 'Sort',
      body: 'Sort by last update, creation, priority, key or rank, and flip the order with the arrow.',
    },
    {
      id: 'results',
      anchor: 'search.results',
      placement: 'above',
      title: 'Results',
      body: 'J and K move through the results, Enter peeks at a ticket without leaving the page and Shift+Enter opens it in full.',
    },
    {
      id: 'export',
      anchor: 'search.export',
      title: 'Export CSV',
      body: 'Download the current results, with these filters, as a CSV file of up to 10 000 rows.',
    },
  ],
};
