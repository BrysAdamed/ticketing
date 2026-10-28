import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, merge, Observable } from 'rxjs';
import { ApiClient } from '../../api/api-client';
import { Page } from '../../api/page';
import { BoardCreator } from '../../boards/create-board';
import { BoardSummary } from '../../boards/board.models';
import { ProjectCreator } from '../../projects/create-project';
import { ProjectSummary } from '../../projects/project-directory';
import { Ticket, TicketSummary } from '../../tickets/ticket.models';
import { TourConditionResult, TourConditions } from '../engine/tour-conditions';
import { ownedProjects } from './first-project.logic';
import {
  FIRST_PROJECT_ACTIONS,
  FIRST_PROJECT_CONDITIONS,
  FIRST_PROJECT_SUGGESTIONS,
} from './first-project.tour';

type Params = Readonly<Record<string, string>>;

const NO: TourConditionResult = { holds: false };
const OWNED_LIMIT = 100;
const REMEMBERED_KEY = 'tk-first-project';

/// The walkthrough's conditions over real data (D-140). Every check is a fresh GET, so an action
/// counts however it was done (quick-create, `c`, the board, REST, MCP, another tab). They run when
/// the step starts, after any successful write of this app (`ApiClient.writes`), when the window
/// gets focus, and (from the engine) after navigation or when the user's dialog closes; no polling.
@Injectable({ providedIn: 'root' })
export class FirstProjectConditions implements TourConditions {
  private readonly api = inject(ApiClient);
  private readonly projects = inject(ProjectCreator);
  private readonly boards = inject(BoardCreator);
  private readonly window = inject(DOCUMENT).defaultView;

  readonly changes: Observable<unknown> = this.window
    ? merge(this.api.writes, fromEvent(this.window, 'focus'))
    : this.api.writes;

  async check(id: string, params: Params): Promise<TourConditionResult> {
    try {
      switch (id) {
        case FIRST_PROJECT_CONDITIONS.projectCreated:
          return await this.projectCreated(params);
        case FIRST_PROJECT_CONDITIONS.ticketCreated:
          return await this.ticketCreated(params);
        case FIRST_PROJECT_CONDITIONS.statusChanged:
          return await this.statusChanged(params);
        case FIRST_PROJECT_CONDITIONS.boardLinksProject:
          return await this.boardLinksProject(params);
        case FIRST_PROJECT_CONDITIONS.ticketOnBoard:
          return await this.ticketOnBoard(params);
        default:
          return NO;
      }
    } catch {
      return NO;
    }
  }

  async run(id: string, params: Params): Promise<Record<string, string> | null> {
    if (id === FIRST_PROJECT_ACTIONS.createProject) {
      const project = await this.projects.open({
        name: params['suggestedName'],
        key: params['suggestedKey'],
        visibility: 'Private',
      });
      if (!project) return null;
      remember(project.key);
      return { projectKey: project.key };
    }
    if (id === FIRST_PROJECT_ACTIONS.createBoard && params['projectKey']) {
      const board = await this.boards.open({
        name: FIRST_PROJECT_SUGGESTIONS.boardName,
        projectKeys: [params['projectKey']],
      });
      return board ? { boardId: board.id } : null;
    }
    return null;
  }

  /// The user's live owned projects (explicit Owner membership, not archived).
  async owned(): Promise<ProjectSummary[]> {
    const page = await firstValueFrom(
      this.api.list<ProjectSummary>('/projects', { limit: OWNED_LIMIT }, { mine: true }),
    );
    return ownedProjects(page.items);
  }

  rememberedProject(): string | null {
    try {
      return localStorage.getItem(REMEMBERED_KEY);
    } catch {
      return null;
    }
  }

  private async projectCreated(params: Params): Promise<TourConditionResult> {
    const known = params['projectKey'];
    const owned = await this.owned();
    if (known) return owned.some((p) => p.key === known) ? { holds: true } : NO;
    const before = new Set((params['ownedBefore'] ?? '').split(',').filter(Boolean));
    const created = owned.find((p) => !before.has(p.key));
    if (!created) return NO;
    remember(created.key);
    return { holds: true, params: { projectKey: created.key } };
  }

  private async ticketCreated(params: Params): Promise<TourConditionResult> {
    const projectKey = params['projectKey'];
    if (!projectKey) return NO;
    const page = await firstValueFrom(
      this.api.get<Page<TicketSummary>>('/tickets/search', {
        project: projectKey,
        reporter: 'me',
        sort: 'created',
        order: 'desc',
        limit: 1,
      }),
    );
    const ticket = page.items[0];
    return ticket ? { holds: true, params: { ticketKey: ticket.key } } : NO;
  }

  private async statusChanged(params: Params): Promise<TourConditionResult> {
    const ticket = await this.ticket(params);
    if (!ticket) return NO;
    return { holds: Date.parse(ticket.statusChangedAt) > Date.parse(ticket.createdAt) };
  }

  private async boardLinksProject(params: Params): Promise<TourConditionResult> {
    const ticket = await this.ticket(params);
    if (ticket?.location.kind === 'Board' && ticket.location.boardId)
      return { holds: true, params: { boardId: ticket.location.boardId } };
    const projectKey = params['projectKey'];
    if (!projectKey) return NO;
    const page = await firstValueFrom(
      this.api.list<BoardSummary>('/boards', { limit: OWNED_LIMIT }, { projectKey }),
    );
    const board = page.items
      .filter((b) => !b.archivedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return board ? { holds: true, params: { boardId: board.id } } : NO;
  }

  private async ticketOnBoard(params: Params): Promise<TourConditionResult> {
    const ticket = await this.ticket(params);
    if (ticket?.location.kind !== 'Board' || !ticket.location.boardId) return NO;
    return { holds: true, params: { boardId: ticket.location.boardId } };
  }

  private async ticket(params: Params): Promise<Ticket | null> {
    const key = params['ticketKey'];
    return key
      ? firstValueFrom(this.api.get<Ticket>(`/tickets/${encodeURIComponent(key)}`))
      : null;
  }
}

function remember(projectKey: string): void {
  try {
    localStorage.setItem(REMEMBERED_KEY, projectKey);
  } catch {
    // Storage can be unavailable; "Use <project>" then offers the most recently updated one.
  }
}
