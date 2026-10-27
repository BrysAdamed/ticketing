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

/// `GET /tickets/{key}/children/graph`: the children plus readable linked tickets outside the
/// parent (`external`), and the links between them. A `Blocks` edge goes from the blocking ticket.
export interface TicketGraph {
  key: string;
  nodes: TicketGraphNode[];
  edges: TicketGraphEdge[];
}

export interface TicketGraphNode extends TicketRef {
  external: boolean;
  blocked: boolean;
}

export interface TicketGraphEdge {
  linkId: string;
  type: TicketLinkType;
  from: string;
  to: string;
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

/// `GET/PUT/DELETE /tickets/{key}/watchers[/me]`: active watchers who can read the project, by name.
export interface Watchers {
  count: number;
  watching: boolean;
  users: UserRef[];
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
  /// Users mentioned in the body who are active and can read the project (D-96); other tokens render as text.
  mentions: UserRef[];
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
  /// Users mentioned in the description who are active and can read the project (D-96).
  mentions: UserRef[];
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
  watchers: Watchers | null;
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
  /// Creates the ticket on this board (bottom of its status column) instead of the backlog (spec 6.4).
  boardId?: string | null;
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
  /// Tickets matching the same filters that sit on a board instead ("N more on boards").
  onBoardsCount: number;
}

export type RankPosition = 'Top' | 'Bottom';

/// `backlog` (each ticket's own project backlog) or a board id.
export type TicketContainer = 'backlog' | string;

/// `POST /tickets/move`, the one placement call (D-66): keys in their final order, the target container,
/// an optional column and at most one anchor. `from` makes the server reject tickets that left that container.
export interface MoveTicketsRequest {
  keys: string[];
  target: TicketContainer;
  status?: TicketStatus;
  beforeKey?: string;
  afterKey?: string;
  position?: RankPosition;
  from?: TicketContainer;
  /// Also moves the descendants (up to 3 levels) still in the place each ticket leaves and not Done;
  /// each lands right after its nearest selected ancestor. `status` applies to the selected tickets only.
  includeChildren?: boolean;
}

/// `GET /tickets/move/children`: what `includeChildren` would add, per selected ticket (in `keys`
/// order), and the descendants it would leave behind.
export interface MoveChildrenPreview {
  parents: MoveChildrenParent[];
  /// Qualifying children over all parents, a selected ticket never counted as a child.
  count: number;
  /// Skipped: on a board other than the place the parent is leaving.
  onOtherBoard: number;
  /// Skipped: in the backlog while the parent is on a board.
  inBacklog: number;
  /// Skipped: Done.
  done: number;
}

export interface MoveChildrenParent {
  key: string;
  /// In the order they would be placed.
  children: TicketSummary[];
  onOtherBoard: number;
  inBacklog: number;
  done: number;
}
