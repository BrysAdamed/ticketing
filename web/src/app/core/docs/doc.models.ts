import { ProjectRole } from '@shared/domain/enums';
import { UserRef } from '../tickets/ticket.models';

export const DOC_KINDS = ['Folder', 'Page', 'Diagram'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const DIAGRAM_FORMATS = ['Mermaid', 'Canvas'] as const;
export type DiagramFormat = (typeof DIAGRAM_FORMATS)[number];

/// Limits the server enforces on the tree (spec 12.2); the client mirrors them to refuse a move
/// before it is sent.
export const DOC_TREE_LIMITS = {
  maxDepth: 6,
  maxFolderChildren: 500,
  maxProjectDocs: 5000,
  titleMaxLength: 200,
} as const;

/// One node of the flat, depth-first tree (root children have depth 1), in manual sibling order.
export interface DocTreeItem {
  id: string;
  key: string;
  kind: DocKind;
  diagramFormat: DiagramFormat | null;
  title: string;
  parentKey: string | null;
  depth: number;
  version: number;
  childCount: number;
  updatedAt: string;
  hasMyDraft: boolean;
  canDelete: boolean;
}

export interface DocTree {
  projectKey: string;
  myRole: ProjectRole | null;
  canWrite: boolean;
  canManageTrash: boolean;
  total: number;
  items: DocTreeItem[];
}

export interface DocCrumb {
  key: string;
  title: string;
}

export interface DocPermissions {
  canEdit: boolean;
  canDelete: boolean;
}

export interface DocEditor {
  user: UserRef;
  since: string;
  lastActiveAt: string;
}

export interface DocMyDraft {
  baseVersion: number;
  updatedAt: string;
}

/// A doc with its latest published content (`GET /docs/{key}`). `version` is the content version
/// sent back as `baseVersion`; `rowVersion` changes on every write, renames and moves included.
export interface Doc {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  kind: DocKind;
  diagramFormat: DiagramFormat | null;
  title: string;
  path: string;
  parentKey: string | null;
  breadcrumb: DocCrumb[];
  content: string | null;
  version: number;
  createdBy: UserRef;
  createdAt: string;
  updatedBy: UserRef;
  updatedAt: string;
  myRole: ProjectRole | null;
  permissions: DocPermissions;
  editors: DocEditor[];
  myDraft: DocMyDraft | null;
  children: DocTreeItem[] | null;
  url: string;
  rowVersion: number;
  /// Comments that are not deleted (0 for folders).
  commentCount: number;
}

/// A recently updated page or diagram (Docs home).
export interface DocSummary {
  id: string;
  key: string;
  projectKey: string;
  kind: DocKind;
  diagramFormat: DiagramFormat | null;
  title: string;
  path: string;
  version: number;
  updatedBy: UserRef;
  updatedAt: string;
  url: string;
}

/// A group deleted together, shown by its root; `count` includes the root.
export interface DocTrashItem {
  id: string;
  key: string;
  kind: DocKind;
  diagramFormat: DiagramFormat | null;
  title: string;
  formerPath: string;
  count: number;
  deletedBy: UserRef;
  deletedAt: string;
}

export interface DeletedDoc {
  id: string;
  key: string;
  deletedCount: number;
  deletedAt: string;
  undoUntil: string;
}

export type DocPosition = 'Top' | 'Bottom';

/// Where a doc goes: `parent` is a folder key or `root`; at most one of `position`, `beforeKey`
/// and `afterKey` (the default is the bottom of the folder).
export interface DocPlacement {
  parent?: string;
  position?: DocPosition;
  beforeKey?: string;
  afterKey?: string;
}

export interface NewDoc extends DocPlacement {
  kind: DocKind;
  title: string;
  diagramFormat?: DiagramFormat;
  content?: string;
}

export const DOC_ROOT = 'root';

/// Most characters a page may hold (spec 12.2).
export const PAGE_CONTENT_MAX_LENGTH = 100_000;

/// The caller's private, unpublished edit of a page or diagram (`GET|PUT /docs/{key}/draft`).
/// `title` may be empty while it is being typed.
export interface DocDraft {
  docKey: string;
  baseVersion: number;
  currentVersion: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveDocDraft {
  baseVersion: number;
  title: string;
  content: string;
}

/// `PATCH /docs/{key}`: a rename and/or new content; `content` needs `baseVersion`, and a stale
/// one answers 409 `doc.version.conflict`.
export interface UpdateDoc {
  title?: string;
  content?: string;
  baseVersion?: number;
  changeNote?: string | null;
}

export type WriteChannel = 'Web' | 'Api' | 'Mcp';

/// One published version with its full content (`GET /docs/{key}/versions/{n}`).
export interface DocVersion {
  docKey: string;
  number: number;
  title: string;
  content: string | null;
  changeNote: string | null;
  author: UserRef;
  channel: WriteChannel;
  createdAt: string;
  restoredFrom: number | null;
}

/// A file attached to a page (`GET /docs/{key}/attachments`); pasted images embed `url`.
export interface DocAttachment {
  id: string;
  docKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  isImage: boolean;
  uploadedAt: string;
  uploadedBy: UserRef;
  url: string;
  canDelete: boolean;
}

export const MAX_ATTACHMENTS_PER_PAGE = 200;
