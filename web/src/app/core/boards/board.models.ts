import { Priority, Severity, StatusCategory, TicketStatus, TicketType } from '@shared/domain/enums';
import { UserRef } from '../tickets/ticket.models';

/// Wire types of the boards slice (`/api/v1/boards`). Moves use `TicketsApi.move`.

export interface StatusCategoryCounts {
  toDo: number;
  inProgress: number;
  done: number;
}

export interface BoardProjectRef {
  id: string;
  key: string;
  name: string;
}

/// Item of `GET /boards`: only projects and cards the caller can read are listed and counted.
export interface BoardSummary {
  id: string;
  name: string;
  description: string | null;
  owner: UserRef;
  projects: BoardProjectRef[];
  counts: StatusCategoryCounts;
  canManage: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface BoardProject {
  id: string;
  key: string;
  name: string;
  canWrite: boolean;
  isArchived: boolean;
  cardCount: number;
}

/// A lean card; the assignee and parent are resolved through `Board.users` and `Board.parents`.
export interface BoardCard {
  id: string;
  key: string;
  projectKey: string;
  title: string;
  type: TicketType;
  priority: Priority;
  severity: Severity | null;
  storyPoints: number | null;
  labels: string[];
  assigneeId: string | null;
  parentId: string | null;
  /// Non-deleted children wherever they are; 0 for cards without children.
  childCount: number;
  childDoneCount: number;
}

export interface BoardColumn {
  status: TicketStatus;
  category: StatusCategory;
  cards: BoardCard[];
}

/// A card's parent; `parentId` is the parent's own parent, so the epic two levels up can be found.
export interface BoardParent {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  parentId: string | null;
}

export interface Board {
  id: string;
  name: string;
  description: string | null;
  owner: UserRef;
  archivedAt: string | null;
  createdAt: string;
  permissions: { canManage: boolean };
  projects: BoardProject[];
  columns: BoardColumn[];
  users: UserRef[];
  parents: BoardParent[];
  rowVersion: number;
}

export interface NewBoard {
  name: string;
  description?: string | null;
  projectKeys: string[];
}

export interface BoardPatch {
  name?: string;
  description?: string | null;
  addProjectKeys?: string[];
  removeProjectKeys?: string[];
  /// Email or user id of the new owner.
  owner?: string;
}

/// `backlog` or the id of another active board.
export type CarryOverTarget = 'backlog' | string;

export interface ArchiveBoardResult {
  board: Board;
  carriedOverToBoardId: string | null;
  movedToBoard: number;
  movedToBacklog: number;
  stayedDone: number;
}


export interface BoardListQuery {
  query?: string | null;
  projectKey?: string | null;
  includeArchived?: boolean;
  mine?: boolean;
}
