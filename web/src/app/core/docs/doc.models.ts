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
