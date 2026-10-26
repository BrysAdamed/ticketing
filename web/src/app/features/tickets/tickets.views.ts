import { defineView } from '@core/views/view-definition';

/// One ticket detail component hosted two ways (layout-and-screens §2): routed at
/// /tickets/:ticketKey with `presentation = 'page'`, and in the shell's peek panel
/// (`?peek=KEY`) with `presentation = 'peek'`.
export const TICKET_DETAIL_VIEW = defineView({
  viewId: 'ticket.detail',
  variants: {
    default: () => import('./detail/ticket-detail.view').then((m) => m.TicketDetailView),
  },
});
