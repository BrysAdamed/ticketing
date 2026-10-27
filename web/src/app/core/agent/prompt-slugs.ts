import { TICKET_TYPE_LABELS, TICKET_TYPES, TicketType } from '@shared/domain/enums';
import { AgentPromptSlot } from './agent-prompt.models';

const GUARDRAILS_SLUG = 'guardrails';

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

/// URL segment of an instance slot: a ticket type's slug or `guardrails`.
export function promptSlotSlug(slot: AgentPromptSlot): string {
  return slot === 'Guardrails' ? GUARDRAILS_SLUG : promptTypeSlug(slot);
}

export function promptSlotFromSlug(slug: string | null | undefined): AgentPromptSlot | null {
  return slug?.toLowerCase() === GUARDRAILS_SLUG ? 'Guardrails' : promptTypeFromSlug(slug);
}

export function promptSlotLabel(slot: AgentPromptSlot): string {
  return slot === 'Guardrails' ? 'Guardrails' : TICKET_TYPE_LABELS[slot];
}
