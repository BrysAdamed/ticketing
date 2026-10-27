import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../notify/confirm.service';
import {
  mayHaveChildren,
  MoveDestination,
  moveChildrenPrompt,
  MoveSource,
  childKeys,
} from './move-children-prompt';
import { TicketContainer } from './ticket.models';
import { TicketsApi } from './tickets.api';

export interface MoveChildrenQuestion {
  /// The selected tickets, in move order.
  keys: readonly string[];
  /// `from` of the move: the place the tickets leave.
  from: TicketContainer;
  /// Child counts already loaded for the selected tickets; the preview is fetched only when one is above 0.
  childCounts: readonly number[];
  source: MoveSource;
  destination: MoveDestination;
}

/// What to send with the move, or null when the user cancelled.
export interface MoveChildrenDecision {
  includeChildren: boolean;
  /// Keys of the sub-tickets that come along (placement order), for optimistic updates.
  childKeys: string[];
}

const WITHOUT_CHILDREN: MoveChildrenDecision = { includeChildren: false, childKeys: [] };

/// Asks, before a move, whether the selected tickets' sub-tickets still in the place they leave
/// should come along (TKT-71). No question when none has such sub-tickets.
@Injectable({ providedIn: 'root' })
export class MoveChildren {
  private readonly api = inject(TicketsApi);
  private readonly confirm = inject(ConfirmService);

  async ask(question: MoveChildrenQuestion): Promise<MoveChildrenDecision | null> {
    if (question.keys.length === 0 || !mayHaveChildren(question.childCounts))
      return WITHOUT_CHILDREN;
    let preview;
    try {
      preview = await firstValueFrom(this.api.moveChildren(question.keys, question.from));
    } catch {
      return WITHOUT_CHILDREN;
    }
    const prompt = moveChildrenPrompt(preview, question.source, question.destination);
    if (!prompt) return WITHOUT_CHILDREN;
    const choice = await this.confirm.choose({
      title: prompt.title,
      message: prompt.message,
      detail: prompt.detail ?? undefined,
      confirmLabel: 'Move with sub-tickets',
      alternativeLabel: 'Only the selected tickets',
    });
    if (choice === 'cancel') return null;
    return choice === 'confirm'
      ? { includeChildren: true, childKeys: childKeys(preview) }
      : WITHOUT_CHILDREN;
  }
}
