import { UserRef } from '../tickets/ticket.models';

export const NOTIFICATION_KINDS = [
  'Assigned',
  'Mentioned',
  'Commented',
  'StatusChanged',
  'PriorityRaised',
  'Moved',
  'Deleted',
  'RegressionItemAssigned',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationTicketRef {
  key: string;
  title: string;
  deleted: boolean;
}

export interface NotificationRegressionRef {
  sessionKey: string;
  sessionName: string;
  testCaseKey: string | null;
}

export interface NotificationDocRef {
  key: string;
  title: string;
  deleted: boolean;
}

/// `GET /me/notifications`: one row per recipient, collapsed per actor and ticket within five
/// minutes (`eventCount`). `summary` is a server-rendered one-liner without the actor's name.
export interface UserNotification {
  id: string;
  kind: NotificationKind;
  summary: string;
  eventCount: number;
  actor: UserRef | null;
  projectKey: string;
  ticket: NotificationTicketRef | null;
  regression: NotificationRegressionRef | null;
  /// The page or diagram, for doc comments (`url` opens its comments).
  doc: NotificationDocRef | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
}

export type NotificationFilter = 'all' | 'unread';
