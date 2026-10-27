import {
  DOC_TREE_LIMITS,
  DocKind,
  DocPlacement,
  DocTreeItem,
  DiagramFormat,
} from '@core/docs/doc.models';

export type ParentKey = string | null;

/// Children of every folder (and of the root, `null`) in manual order.
export interface TreeIndex {
  readonly byKey: ReadonlyMap<string, DocTreeItem>;
  readonly children: ReadonlyMap<ParentKey, readonly DocTreeItem[]>;
}

export interface NodeRow {
  readonly type: 'node';
  readonly item: DocTreeItem;
  readonly depth: number;
  readonly expanded: boolean;
  readonly hasChildren: boolean;
}

/// The inline "new folder / page / diagram" input, shown at the end of its folder.
export interface CreateRow {
  readonly type: 'create';
  readonly depth: number;
  readonly parentKey: ParentKey;
  readonly kind: DocKind;
}

export type TreeRow = NodeRow | CreateRow;

export interface CreateDraft {
  readonly parentKey: ParentKey;
  readonly kind: DocKind;
  readonly diagramFormat: DiagramFormat | null;
}

/// Why a move is refused, with the server's error code where the server has one.
export type MoveRefusal =
  | 'noop'
  | 'doc.parent.invalid'
  | 'doc.tree.cycle'
  | 'doc.tree.depth'
  | 'doc.tree.folderFull'
  | 'doc.title.duplicate';

export const MOVE_REFUSAL_MESSAGES: Record<Exclude<MoveRefusal, 'noop'>, string> = {
  'doc.parent.invalid': 'Docs can only go into folders.',
  'doc.tree.cycle': "A folder can't move into itself or one of its subfolders.",
  'doc.tree.depth': `Docs can be nested at most ${DOC_TREE_LIMITS.maxDepth} levels deep.`,
  'doc.tree.folderFull': `A folder can hold at most ${DOC_TREE_LIMITS.maxFolderChildren} docs.`,
  'doc.title.duplicate': 'A doc with the same title is already in that folder. Rename it first.',
};

export function indexTree(items: readonly DocTreeItem[]): TreeIndex {
  const byKey = new Map<string, DocTreeItem>();
  const children = new Map<ParentKey, DocTreeItem[]>([[null, []]]);
  for (const item of items) {
    byKey.set(item.key, item);
    const siblings = children.get(item.parentKey);
    if (siblings) siblings.push(item);
    else children.set(item.parentKey, [item]);
  }
  return { byKey, children };
}

export function childrenOf(index: TreeIndex, parentKey: ParentKey): readonly DocTreeItem[] {
  return index.children.get(parentKey) ?? [];
}

/// Depth-first, in manual order, with `depth` and `childCount` recomputed from the parent links.
/// Nodes whose parent is missing are dropped (a deleted folder takes its subtree with it).
export function flatten(children: ReadonlyMap<ParentKey, readonly DocTreeItem[]>): DocTreeItem[] {
  const result: DocTreeItem[] = [];
  const stack: { item: DocTreeItem; depth: number }[] = [];
  const push = (parentKey: ParentKey, depth: number) => {
    const list = children.get(parentKey) ?? [];
    for (let i = list.length - 1; i >= 0; i--) stack.push({ item: list[i], depth });
  };
  push(null, 1);
  while (stack.length) {
    const { item, depth } = stack.pop()!;
    const childCount = children.get(item.key)?.length ?? 0;
    result.push(
      item.depth === depth && item.childCount === childCount
        ? item
        : { ...item, depth, childCount },
    );
    push(item.key, depth + 1);
  }
  return result;
}

export function ancestorsOf(index: TreeIndex, key: string): string[] {
  const result: string[] = [];
  for (let parent = index.byKey.get(key)?.parentKey ?? null; parent;) {
    result.push(parent);
    parent = index.byKey.get(parent)?.parentKey ?? null;
  }
  return result;
}

export function isSelfOrDescendant(index: TreeIndex, candidate: ParentKey, ancestor: string) {
  for (let key = candidate; key; key = index.byKey.get(key)?.parentKey ?? null) {
    if (key === ancestor) return true;
  }
  return false;
}

/// Every key below `key` (not `key` itself).
export function descendantsOf(index: TreeIndex, key: string): string[] {
  const result: string[] = [];
  const queue = [...childrenOf(index, key)];
  while (queue.length) {
    const next = queue.shift()!;
    result.push(next.key);
    queue.push(...childrenOf(index, next.key));
  }
  return result;
}

/// 1 for a page, diagram or empty folder, otherwise 1 + the tallest child (server `HeightOf`).
export function heightOf(index: TreeIndex, key: string): number {
  let max = 0;
  for (const child of childrenOf(index, key)) max = Math.max(max, heightOf(index, child.key));
  return 1 + max;
}

/// The depth a node gets directly under `parentKey` (root children are depth 1).
export function depthUnder(index: TreeIndex, parentKey: ParentKey): number {
  return 1 + (parentKey ? ancestorsOf(index, parentKey).length + 1 : 0);
}

export function titleTaken(
  index: TreeIndex,
  parentKey: ParentKey,
  title: string,
  exceptKey: string | null = null,
): boolean {
  const wanted = title.trim().toLowerCase();
  return childrenOf(index, parentKey).some(
    (sibling) => sibling.key !== exceptKey && sibling.title.toLowerCase() === wanted,
  );
}

/// The checks the server runs for a move (`DocTreeShape.EnsureCanMove` plus the sibling title
/// rule), so an invalid drop is refused without a round trip. `noop` when nothing would change.
export function validateMove(
  index: TreeIndex,
  key: string,
  placement: DocPlacement,
): MoveRefusal | null {
  const item = index.byKey.get(key);
  if (!item) return 'noop';
  const parentKey = parentOf(placement, item.parentKey);
  if (placement.beforeKey === key || placement.afterKey === key) return 'noop';
  if (parentKey !== null) {
    const parent = index.byKey.get(parentKey);
    if (!parent || parent.kind !== 'Folder') return 'doc.parent.invalid';
    if (isSelfOrDescendant(index, parentKey, key)) return 'doc.tree.cycle';
  }
  if (depthUnder(index, parentKey) + heightOf(index, key) - 1 > DOC_TREE_LIMITS.maxDepth)
    return 'doc.tree.depth';
  if (parentKey !== item.parentKey) {
    if (
      parentKey !== null &&
      childrenOf(index, parentKey).length + 1 > DOC_TREE_LIMITS.maxFolderChildren
    )
      return 'doc.tree.folderFull';
    if (titleTaken(index, parentKey, item.title, key)) return 'doc.title.duplicate';
  }
  const before = childrenOf(index, item.parentKey).map((c) => c.key);
  const after = placeIn(index, key, parentKey, placement)
    .get(parentKey)!
    .map((c) => c.key);
  if (parentKey === item.parentKey && before.join('\n') === after.join('\n')) return 'noop';
  return null;
}

/// The flat tree with `key` (and its subtree) moved to `placement`.
export function applyMove(
  items: readonly DocTreeItem[],
  key: string,
  placement: DocPlacement,
): DocTreeItem[] {
  const index = indexTree(items);
  const item = index.byKey.get(key);
  if (!item) return [...items];
  return flatten(placeIn(index, key, parentOf(placement, item.parentKey), placement));
}

/// The flat tree with a new node inserted at `placement` (bottom of the folder by default).
export function applyInsert(
  items: readonly DocTreeItem[],
  item: DocTreeItem,
  placement: DocPlacement,
): DocTreeItem[] {
  const index = indexTree([...items, { ...item, parentKey: parentOf(placement, null) }]);
  return flatten(placeIn(index, item.key, parentOf(placement, null), placement));
}

/// The flat tree without `key` and its subtree, and the keys that were removed.
export function applyRemove(
  items: readonly DocTreeItem[],
  key: string,
): { items: DocTreeItem[]; removed: string[] } {
  const index = indexTree(items);
  if (!index.byKey.has(key)) return { items: [...items], removed: [] };
  const removed = new Set([key, ...descendantsOf(index, key)]);
  return { items: items.filter((i) => !removed.has(i.key)), removed: [...removed] };
}

export function applyPatch(
  items: readonly DocTreeItem[],
  key: string,
  patch: Partial<DocTreeItem>,
): DocTreeItem[] {
  return items.map((i) => (i.key === key ? { ...i, ...patch } : i));
}

/// Rows on screen: collapsed folders hide their subtree. A filter keeps matching titles and their
/// ancestors, which it shows expanded. The inline create row goes at the end of its folder.
export function visibleRows(
  items: readonly DocTreeItem[],
  expanded: ReadonlySet<string>,
  filter: string,
  creating: CreateDraft | null = null,
): TreeRow[] {
  const query = filter.trim().toLowerCase();
  const match = query ? matchesWithAncestors(items, query) : null;
  const rows: TreeRow[] = [];
  let hideBelow = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item.depth > hideBelow) continue;
    hideBelow = Number.POSITIVE_INFINITY;
    if (match && !match.shown.has(item.key)) {
      hideBelow = item.depth;
      continue;
    }
    const hasChildren = item.childCount > 0;
    const open =
      item.kind === 'Folder' && (match ? match.ancestors.has(item.key) : expanded.has(item.key));
    rows.push({ type: 'node', item, depth: item.depth, expanded: open, hasChildren });
    if (item.kind === 'Folder' && !open) hideBelow = item.depth;
  }
  return creating ? withCreateRow(rows, creating) : rows;
}

/// Where a pointer at `y` (pixels from the top of the list) drops: before or after a row, or into
/// a folder (its middle half). Below the last row is the bottom of the root.
export type DropZone = 'before' | 'after' | 'inside';

export interface DropTarget {
  readonly placement: DocPlacement;
  readonly zone: DropZone;
  /// Row index the insert line is drawn above (null when dropping into a folder row).
  readonly lineIndex: number | null;
  readonly lineDepth: number;
  /// The folder row highlighted for an `inside` drop.
  readonly folderKey: string | null;
}

export function dropTargetAt(
  rows: readonly TreeRow[],
  y: number,
  rowHeight: number,
): DropTarget | null {
  const nodes = rows.filter((r): r is NodeRow => r.type === 'node');
  if (nodes.length === 0) return null;
  const index = Math.floor(y / rowHeight);
  if (index >= nodes.length) {
    return {
      placement: { parent: 'root', position: 'Bottom' },
      zone: 'after',
      lineIndex: nodes.length,
      lineDepth: 1,
      folderKey: null,
    };
  }
  const row = nodes[Math.max(0, index)];
  const fraction = index < 0 ? 0 : (y - index * rowHeight) / rowHeight;
  const parent = row.item.parentKey ?? 'root';
  const isFolder = row.item.kind === 'Folder';
  if (isFolder ? fraction < 0.25 : fraction < 0.5) {
    return {
      placement: { parent, beforeKey: row.item.key },
      zone: 'before',
      lineIndex: Math.max(0, index),
      lineDepth: row.depth,
      folderKey: null,
    };
  }
  if (isFolder && fraction <= 0.75) {
    return {
      placement: { parent: row.item.key, position: 'Bottom' },
      zone: 'inside',
      lineIndex: null,
      lineDepth: row.depth + 1,
      folderKey: row.item.key,
    };
  }
  if (isFolder && row.expanded && row.hasChildren) {
    return {
      placement: { parent: row.item.key, position: 'Top' },
      zone: 'after',
      lineIndex: index + 1,
      lineDepth: row.depth + 1,
      folderKey: null,
    };
  }
  return {
    placement: { parent, afterKey: row.item.key },
    zone: 'after',
    lineIndex: index + 1,
    lineDepth: row.depth,
    folderKey: null,
  };
}

/// The placement that moves `key` one step up or down among its siblings (Alt+↑/↓).
export function reorderPlacement(
  index: TreeIndex,
  key: string,
  delta: -1 | 1,
): DocPlacement | null {
  const item = index.byKey.get(key);
  if (!item) return null;
  const siblings = childrenOf(index, item.parentKey);
  const at = siblings.findIndex((s) => s.key === key);
  const neighbour = siblings[at + delta];
  if (!neighbour) return null;
  const parent = item.parentKey ?? 'root';
  return delta < 0 ? { parent, beforeKey: neighbour.key } : { parent, afterKey: neighbour.key };
}

export function parentOf(placement: DocPlacement, current: ParentKey): ParentKey {
  if (placement.parent === undefined) return current;
  return placement.parent === 'root' ? null : placement.parent;
}

function placeIn(
  index: TreeIndex,
  key: string,
  parentKey: ParentKey,
  placement: DocPlacement,
): Map<ParentKey, DocTreeItem[]> {
  const item = index.byKey.get(key)!;
  const children = new Map<ParentKey, DocTreeItem[]>();
  for (const [parent, list] of index.children)
    children.set(
      parent,
      list.filter((c) => c.key !== key),
    );
  const target = children.get(parentKey) ?? [];
  let at = target.length;
  if (placement.position === 'Top') at = 0;
  else if (placement.beforeKey) at = indexOrEnd(target, placement.beforeKey, 0);
  else if (placement.afterKey) at = indexOrEnd(target, placement.afterKey, 1);
  target.splice(at, 0, item.parentKey === parentKey ? item : { ...item, parentKey });
  children.set(parentKey, target);
  return children;
}

function indexOrEnd(list: readonly DocTreeItem[], key: string, offset: number): number {
  const at = list.findIndex((c) => c.key === key);
  return at < 0 ? list.length : at + offset;
}

function matchesWithAncestors(
  items: readonly DocTreeItem[],
  query: string,
): { shown: Set<string>; ancestors: Set<string> } {
  const index = indexTree(items);
  const shown = new Set<string>();
  const ancestors = new Set<string>();
  for (const item of items) {
    if (!item.title.toLowerCase().includes(query)) continue;
    shown.add(item.key);
    for (const ancestor of ancestorsOf(index, item.key)) {
      if (ancestors.has(ancestor)) break;
      ancestors.add(ancestor);
      shown.add(ancestor);
    }
  }
  return { shown, ancestors };
}

function withCreateRow(rows: TreeRow[], creating: CreateDraft): TreeRow[] {
  const create = (depth: number): CreateRow => ({
    type: 'create',
    depth,
    parentKey: creating.parentKey,
    kind: creating.kind,
  });
  if (creating.parentKey === null) return [...rows, create(1)];
  const at = rows.findIndex((r) => r.type === 'node' && r.item.key === creating.parentKey);
  if (at < 0) return [...rows, create(1)];
  const parentDepth = rows[at].depth;
  let end = at + 1;
  while (end < rows.length && rows[end].depth > parentDepth) end++;
  return [...rows.slice(0, end), create(parentDepth + 1), ...rows.slice(end)];
}
