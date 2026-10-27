/// Domain enumerations from spec section 3. Values travel over the wire as these exact PascalCase
/// strings; labels are display-only. Arrays are in the spec's display order.

export const GLOBAL_ROLES = ['Admin', 'User'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];
export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = { Admin: 'Admin', User: 'User' };

export const PROJECT_ROLES = ['Owner', 'Member', 'Viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  Owner: 'Owner',
  Member: 'Member',
  Viewer: 'Viewer',
};

export const PROJECT_VISIBILITIES = ['Private', 'Public'] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];
export const PROJECT_VISIBILITY_LABELS: Record<ProjectVisibility, string> = {
  Private: 'Private',
  Public: 'Public',
};

export const TICKET_TYPES = ['Epic', 'UserStory', 'Technical', 'Spike', 'Bug'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  Epic: 'Epic',
  UserStory: 'User Story',
  Technical: 'Technical',
  Spike: 'Spike',
  Bug: 'Bug',
};

export const TICKET_STATUSES = [
  'ToDo',
  'InProgress',
  'OnHold',
  'Review',
  'ReadyForTesting',
  'Testing',
  'ReadyForDeploy',
  'Done',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  ToDo: 'To Do',
  InProgress: 'In Progress',
  OnHold: 'On Hold',
  Review: 'Review',
  ReadyForTesting: 'Ready for Testing',
  Testing: 'Testing',
  ReadyForDeploy: 'Ready for Deploy',
  Done: 'Done',
};

export const STATUS_CATEGORIES = ['ToDo', 'InProgress', 'Done'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];
export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  ToDo: 'To Do',
  InProgress: 'In Progress',
  Done: 'Done',
};

export function statusCategory(status: TicketStatus): StatusCategory {
  if (status === 'ToDo') return 'ToDo';
  if (status === 'Done') return 'Done';
  return 'InProgress';
}

export function isOpenStatus(status: TicketStatus): boolean {
  return statusCategory(status) !== 'Done';
}

export const RESOLUTIONS = ['Done', 'WontDo', 'Duplicate', 'CannotReproduce'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const RESOLUTION_LABELS: Record<Resolution, string> = {
  Done: 'Done',
  WontDo: "Won't Do",
  Duplicate: 'Duplicate',
  CannotReproduce: 'Cannot Reproduce',
};

export const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = {
  Highest: 'Highest',
  High: 'High',
  Medium: 'Medium',
  Low: 'Low',
  Lowest: 'Lowest',
};

export const SEVERITIES = ['Blocker', 'Critical', 'Major', 'Minor', 'Trivial'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = {
  Blocker: 'Blocker',
  Critical: 'Critical',
  Major: 'Major',
  Minor: 'Minor',
  Trivial: 'Trivial',
};

export const TICKET_LINK_TYPES = ['Blocks', 'RelatesTo', 'Duplicates'] as const;
export type TicketLinkType = (typeof TICKET_LINK_TYPES)[number];
export const TICKET_LINK_TYPE_LABELS: Record<TicketLinkType, string> = {
  Blocks: 'blocks',
  RelatesTo: 'relates to',
  Duplicates: 'duplicates',
};
export const TICKET_LINK_TYPE_INVERSE_LABELS: Record<TicketLinkType, string> = {
  Blocks: 'is blocked by',
  RelatesTo: 'relates to',
  Duplicates: 'is duplicated by',
};

export const TEST_CASE_STATUSES = ['New', 'Manual', 'Automatic'] as const;
export type TestCaseStatus = (typeof TEST_CASE_STATUSES)[number];
export const TEST_CASE_STATUS_LABELS: Record<TestCaseStatus, string> = {
  New: 'New',
  Manual: 'Manual',
  Automatic: 'Automatic',
};

export const REGRESSION_SESSION_STATUSES = ['InProgress', 'Completed', 'Cancelled'] as const;
export type RegressionSessionStatus = (typeof REGRESSION_SESSION_STATUSES)[number];
export const REGRESSION_SESSION_STATUS_LABELS: Record<RegressionSessionStatus, string> = {
  InProgress: 'In progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
};

export const REGRESSION_ITEM_STATUSES = [
  'WaitingForExecution',
  'Passed',
  'Failed',
  'Skipped',
] as const;
export type RegressionItemStatus = (typeof REGRESSION_ITEM_STATUSES)[number];
export const REGRESSION_ITEM_STATUS_LABELS: Record<RegressionItemStatus, string> = {
  WaitingForExecution: 'Waiting for execution',
  Passed: 'Passed',
  Failed: 'Failed',
  Skipped: 'Skipped',
};

export const EXECUTION_MODES = ['Manual', 'Automatic'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  Manual: 'Manual',
  Automatic: 'Automatic',
};

export const WRITE_CHANNELS = ['Web', 'Api', 'Mcp'] as const;
export type WriteChannel = (typeof WRITE_CHANNELS)[number];
export const WRITE_CHANNEL_LABELS: Record<WriteChannel, string> = {
  Web: 'Web',
  Api: 'API',
  Mcp: 'MCP',
};

export const PAT_SCOPES = ['ReadOnly', 'ReadWrite'] as const;
export type PatScope = (typeof PAT_SCOPES)[number];
export const PAT_SCOPE_LABELS: Record<PatScope, string> = {
  ReadOnly: 'Read only',
  ReadWrite: 'Read & write',
};

export const ACTIVITY_ENTITY_TYPES = [
  'Ticket',
  'TestCase',
  'RegressionSession',
  'Project',
  'Board',
  'User',
  'PersonalAccessToken',
  'FeatureFlag',
  'AgentPrompt',
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];
export const ACTIVITY_ENTITY_TYPE_LABELS: Record<ActivityEntityType, string> = {
  Ticket: 'Ticket',
  TestCase: 'Test case',
  RegressionSession: 'Regression session',
  Project: 'Project',
  Board: 'Board',
  User: 'User',
  PersonalAccessToken: 'Access token',
  FeatureFlag: 'Feature flag',
  AgentPrompt: 'Agent prompt',
};
