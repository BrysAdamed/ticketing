import {
  Priority,
  ProjectRole,
  Resolution,
  Severity,
  TestCaseStatus,
  TicketLinkType,
  TicketStatus,
  TicketType,
  WriteChannel,
} from '@shared/domain/enums';

/// Wire types of the tickets slice (`/api/v1/tickets`, `/api/v1/projects/{key}/backlog`, comments, history, hints).

export interface UserRef {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
}

export type TicketLocationKind = 'Backlog' | 'Board';

export interface TicketLocation {
  kind: TicketLocationKind;
  boardId: string | null;
  boardName: string | null;
}

export interface TicketSummary {
  id: string;
  key: string;
  projectKey: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  severity: Severity | null;
  assignee: UserRef | null;
  storyPoints: number | null;
  labels: string[];
  version: string | null;
  parentKey: string | null;
  location: TicketLocation;
  updatedAt: string;
  url: string;
  rowVersion: number;
}

export interface TicketRef {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  assignee: UserRef | null;
}

export interface Progress {
  toDo: number;
  inProgress: number;
  done: number;
  total: number;
}

export type LinkDirection = 'Outward' | 'Inward';

export interface TicketLink {
  id: string;
  type: TicketLinkType;
  direction: LinkDirection;
  label: string;
  ticket: TicketRef;
  createdAt: string;
}

export interface TestCaseRef {
  id: string;
  key: string;
  title: string;
  status: TestCaseStatus;
  stepCount: number;
}

export interface TicketPermissions {
  canEdit: boolean;
  canDelete: boolean;
  canComment: boolean;
}

export interface Comment {
  id: string;
  ticketId: string;
  author: UserRef;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  deletedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
}

export interface Ticket {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  number: number;
  title: string;
  description: string | null;
  type: TicketType;
  status: TicketStatus;
  resolution: Resolution | null;
  priority: Priority;
  severity: Severity | null;
  storyPoints: number | null;
  version: string | null;
  labels: string[];
  parent: TicketRef | null;
  location: TicketLocation;
  assignee: UserRef | null;
  reporter: UserRef;
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
  resolvedAt: string | null;
  myRole: ProjectRole;
  permissions: TicketPermissions;
  url: string;
  rowVersion: number;
  children: TicketRef[] | null;
  childProgress: Progress | null;
  links: TicketLink[] | null;
  comments: Comment[] | null;
  commentCount: number | null;
  testCases: TestCaseRef[] | null;
}

export interface ActivityEntry {
  id: string;
  occurredAt: string;
  actor: UserRef | null;
  channel: WriteChannel | null;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
}

export interface TicketHistoryPage {
  items: ActivityEntry[];
  nextCursor: string | null;
  users: UserRef[];
}

/// PATCH body: omitted fields stay, `null` clears an optional field.
export interface TicketPatch {
  title?: string;
  description?: string | null;
  type?: TicketType;
  status?: TicketStatus;
  resolution?: Resolution | null;
  priority?: Priority;
  severity?: Severity | null;
  storyPoints?: number | null;
  version?: string | null;
  labels?: string[];
  addLabels?: string[];
  removeLabels?: string[];
  parentKey?: string | null;
  assignee?: string | null;
  reporter?: string;
}

export interface NewTicket {
  title: string;
  type: TicketType;
  description?: string | null;
  status?: TicketStatus;
  priority?: Priority;
  severity?: Severity | null;
  storyPoints?: number | null;
  version?: string | null;
  labels?: string[];
  parentKey?: string | null;
  assignee?: string | null;
}

export type HintField = 'labels' | 'version';

export interface BacklogItem {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  severity: Severity | null;
  storyPoints: number | null;
  version: string | null;
  labels: string[];
  assigneeId: string | null;
  parentId: string | null;
  updatedAt: string;
  childCount: number;
  childDoneCount: number;
  commentCount: number;
  testCaseCount: number;
}

export interface BacklogParent {
  id: string;
  key: string;
  title: string;
  type: TicketType;
}

export interface Backlog {
  projectId: string;
  projectKey: string;
  canWrite: boolean;
  items: BacklogItem[];
  users: UserRef[];
  parents: BacklogParent[];
  truncated: boolean;
}

export type RankPosition = 'Top' | 'Bottom';

export interface RankRequest {
  tickets: string[];
  beforeKey?: string;
  afterKey?: string;
  position?: RankPosition;
}
