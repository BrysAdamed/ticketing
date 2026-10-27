import { TICKET_TYPE_LABELS, TICKET_TYPES, TicketType } from '@shared/domain/enums';

/// URL segment of a ticket type's prompt editor: `bug`, `user-story`, …
export function promptTypeSlug(type: TicketType): string {
  return type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export function promptTypeFromSlug(slug: string | null | undefined): TicketType | null {
  return TICKET_TYPES.find((type) => promptTypeSlug(type) === slug?.toLowerCase()) ?? null;
}

export function promptTypeLabel(slug: string | null | undefined): string | null {
  const type = promptTypeFromSlug(slug);
  return type ? TICKET_TYPE_LABELS[type] : null;
}
