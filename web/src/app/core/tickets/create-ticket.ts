import {
  EnvironmentProviders,
  inject,
  Injectable,
  InjectionToken,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  DestroyRef,
  Type,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CommandRegistry } from '../commands/command-registry';
import { NavigationContext } from '../layout/navigation-context';
import { NewTicket, TicketSummary } from './ticket.models';

/// Values the create dialog opens with. Every field stays editable in the dialog.
export interface CreateTicketPrefill extends Partial<NewTicket> {
  /// Project key; defaults to the project in context (route or open ticket).
  projectKey?: string;
  /// Put the new ticket at the top of the backlog instead of the bottom (bugs from regressions).
  atTop?: boolean;
}

export const CREATE_TICKET_DIALOG = new InjectionToken<() => Promise<Type<unknown>>>('CREATE_TICKET_DIALOG');

/// Opens the create-ticket dialog from anywhere (global `c`, the top bar "New ticket" button, or another
/// feature, for example the regressions slice for a bug from a failed test). Resolves with the created
/// ticket, or null when the user cancels.
@Injectable({ providedIn: 'root' })
export class TicketCreator {
  private readonly dialog = inject(MatDialog);
  private readonly context = inject(NavigationContext);
  private readonly loadDialog = inject(CREATE_TICKET_DIALOG, { optional: true });

  async open(prefill: CreateTicketPrefill = {}): Promise<TicketSummary | null> {
    if (!this.loadDialog) throw new Error('provideTicketCreation() is missing.');
    if (this.dialog.getDialogById('tk-create-ticket')) return null;
    const component = await this.loadDialog();
    const data: CreateTicketPrefill = { ...prefill, projectKey: prefill.projectKey ?? this.context.projectKey() ?? undefined };
    const ref = this.dialog.open<unknown, CreateTicketPrefill, TicketSummary | null>(component, {
      id: 'tk-create-ticket',
      data,
      width: '640px',
      autoFocus: 'first-tabbable',
    });
    return (await firstValueFrom(ref.afterClosed())) ?? null;
  }
}

/// Wires the create dialog (lazy-loaded) and registers the `ticket.create` command, which also shows
/// the top bar "New ticket" button and binds the global `c` shortcut.
export function provideTicketCreation(loadDialog: () => Promise<Type<unknown>>): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: CREATE_TICKET_DIALOG, useValue: loadDialog },
    provideEnvironmentInitializer(() => {
      const creator = inject(TicketCreator);
      inject(CommandRegistry).registerCommands(
        [
          {
            id: 'ticket.create',
            label: 'Create ticket',
            group: 'Tickets',
            icon: 'tablerPlus',
            shortcut: 'c',
            keywords: ['new', 'ticket', 'bug', 'story'],
            run: () => void creator.open(),
          },
        ],
        inject(DestroyRef),
      );
    }),
  ]);
}
