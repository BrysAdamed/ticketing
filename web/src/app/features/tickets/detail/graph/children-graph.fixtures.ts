import { TicketStatus } from '@shared/domain/enums';
import { TicketGraph, TicketGraphEdge, TicketGraphNode } from '@core/tickets/ticket.models';

export const node = (
  key: string,
  status: TicketStatus = 'ToDo',
  external = false,
): TicketGraphNode => ({
  id: key,
  key,
  title: `Title of ${key}`,
  type: 'UserStory',
  status,
  priority: 'Medium',
  assignee: null,
  external,
  blocked: false,
});

export const blocks = (from: string, to: string): TicketGraphEdge => ({
  linkId: `${from}>${to}`,
  type: 'Blocks',
  from,
  to,
});

export function fiftyTicketsWithCircularLinks(): TicketGraph {
  const nodes = Array.from({ length: 50 }, (_, i) => node(`P-${i + 1}`));
  const edges: TicketGraphEdge[] = [];
  for (let i = 1; i <= 50; i++) {
    if (i > 1) edges.push(blocks(`P-${Math.ceil(i / 2)}`, `P-${i}`));
    if (i % 7 === 0 && i + 3 <= 50) edges.push(blocks(`P-${i}`, `P-${i + 3}`));
  }
  edges.push(blocks('P-50', 'P-1'));
  return { key: 'E-0', nodes, edges };
}
