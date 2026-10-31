import { Injector } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { BoardsApi } from '../boards/boards.api';
import { NavigationContext } from '../layout/navigation-context';
import { ProjectDirectory } from '../projects/project-directory';
import { RegressionsApi } from '../testing/testing.api';
import { rankTourProjects } from './guided-tours.logic';
import type { TourTarget } from './tour-targets';
import { TourTargetKind } from './tours/tour-catalogue';

const SESSION_PROJECTS = 3;

/// Finds something the user can read for a tour to open (D-169): the most recently updated ticket
/// of the best project (`rankTourProjects`), else of any project; an active board the user owns,
/// else any active board; a session in progress in one of the first three projects, else the
/// latest session of the best one. Null when there is none.
export async function findTourTarget(
  injector: Injector,
  kind: TourTargetKind,
): Promise<TourTarget | null> {
  switch (kind) {
    case 'ticket':
      return findTicket(injector);
    case 'board':
      return findBoard(injector);
    case 'regression-session':
      return findSession(injector);
  }
}

async function rankedProjects(injector: Injector): Promise<string[]> {
  const directory = injector.get(ProjectDirectory);
  await directory.load();
  return rankTourProjects(directory.projects(), injector.get(NavigationContext).projectKey());
}

async function findTicket(injector: Injector): Promise<TourTarget | null> {
  const api = injector.get(ApiClient);
  const [best] = await rankedProjects(injector);
  const first = async (query: Record<string, string | number>) =>
    (await firstValueFrom(api.get<{ items: { key: string }[] }>('/tickets/search', query)))
      .items[0] ?? null;
  const ticket =
    (best ? await first({ project: best, limit: 1 }) : null) ?? (await first({ limit: 1 }));
  return ticket ? { url: `/tickets/${encodeURIComponent(ticket.key)}` } : null;
}

async function findBoard(injector: Injector): Promise<TourTarget | null> {
  const boards = injector.get(BoardsApi);
  const first = async (mine: boolean) =>
    (await firstValueFrom(boards.list({ mine }, { limit: 1 }))).items[0] ?? null;
  const board = (await first(true)) ?? (await first(false));
  return board ? { url: `/boards/${board.id}` } : null;
}

async function findSession(injector: Injector): Promise<TourTarget | null> {
  const regressions = injector.get(RegressionsApi);
  const projects = (await rankedProjects(injector)).slice(0, SESSION_PROJECTS);
  const first = async (projectKey: string, inProgress: boolean) =>
    (
      await firstValueFrom(
        regressions.list(projectKey, {
          status: inProgress ? ['InProgress'] : undefined,
          limit: 1,
        }),
      )
    ).items[0] ?? null;
  for (const projectKey of projects) {
    const session = await first(projectKey, true);
    if (session) return sessionTarget(projectKey, session.key);
  }
  const [best] = projects;
  const latest = best ? await first(best, false) : null;
  return best && latest ? sessionTarget(best, latest.key) : null;
}

function sessionTarget(projectKey: string, sessionKey: string): TourTarget {
  return {
    url: `/projects/${projectKey}/regressions/${encodeURIComponent(sessionKey)}`,
    projectKey,
  };
}
