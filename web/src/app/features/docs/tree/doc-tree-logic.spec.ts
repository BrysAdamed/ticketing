import { DocTreeItem } from '@core/docs/doc.models';
import {
  applyInsert,
  applyMove,
  applyRemove,
  dropTargetAt,
  indexTree,
  NodeRow,
  reorderPlacement,
  rowTooltip,
  validateMove,
  visibleRows,
} from './doc-tree-logic';

let counter = 0;

function node(
  key: string,
  parentKey: string | null,
  kind: DocTreeItem['kind'] = 'Page',
  title = key,
): DocTreeItem {
  return {
    id: `id-${++counter}`,
    key,
    kind,
    diagramFormat: null,
    title,
    parentKey,
    depth: 0,
    version: kind === 'Folder' ? 0 : 1,
    childCount: 0,
    updatedAt: '2026-10-27T10:00:00Z',
    hasMyDraft: false,
    commentCount: 0,
    canDelete: true,
  };
}

/// A
///   A1 (page), B (folder) → B1 (page)
/// C (page)
/// D (folder, empty)
function sample(): DocTreeItem[] {
  return applyMove(
    [
      node('A', null, 'Folder'),
      node('A1', 'A'),
      node('B', 'A', 'Folder'),
      node('B1', 'B'),
      node('C', null),
      node('D', null, 'Folder'),
    ],
    'A',
    { position: 'Top' },
  );
}

function keys(items: readonly DocTreeItem[]): string[] {
  return items.map((i) => `${i.key}@${i.depth}`);
}

/// A chain of `levels` nested folders F1 > F2 > … with keys F1..Fn.
function chain(levels: number): DocTreeItem[] {
  const items: DocTreeItem[] = [];
  for (let i = 1; i <= levels; i++)
    items.push(node(`F${i}`, i === 1 ? null : `F${i - 1}`, 'Folder'));
  return applyMove(items, 'F1', { position: 'Top' });
}

describe('doc tree logic', () => {
  describe('flatten and apply', () => {
    it('recomputes depth and child counts depth-first in manual order', () => {
      // Arrange
      const items = sample();

      // Act
      const index = indexTree(items);

      // Assert
      expect(keys(items)).toEqual(['A@1', 'A1@2', 'B@2', 'B1@3', 'C@1', 'D@1']);
      expect(index.byKey.get('A')?.childCount).toBe(2);
      expect(index.byKey.get('D')?.childCount).toBe(0);
    });

    it('moves a folder with its subtree before a root sibling', () => {
      // Act
      const moved = applyMove(sample(), 'B', { parent: 'root', beforeKey: 'C' });

      // Assert
      expect(keys(moved)).toEqual(['A@1', 'A1@2', 'B@1', 'B1@2', 'C@1', 'D@1']);
      expect(moved.find((i) => i.key === 'B')?.parentKey).toBeNull();
      expect(moved.find((i) => i.key === 'A')?.childCount).toBe(1);
    });

    it('moves into a folder at the bottom, the top or after a sibling', () => {
      // Act
      const bottom = applyMove(sample(), 'C', { parent: 'A', position: 'Bottom' });
      const top = applyMove(sample(), 'C', { parent: 'A', position: 'Top' });
      const after = applyMove(sample(), 'C', { parent: 'A', afterKey: 'A1' });

      // Assert
      expect(keys(bottom).slice(0, 5)).toEqual(['A@1', 'A1@2', 'B@2', 'B1@3', 'C@2']);
      expect(keys(top).slice(0, 2)).toEqual(['A@1', 'C@2']);
      expect(keys(after).slice(0, 3)).toEqual(['A@1', 'A1@2', 'C@2']);
    });

    it('inserts a new node and removes a folder with everything in it', () => {
      // Act
      const inserted = applyInsert(sample(), node('N', null), { parent: 'D' });
      const removed = applyRemove(sample(), 'A');

      // Assert
      expect(keys(inserted).slice(-2)).toEqual(['D@1', 'N@2']);
      expect(removed.removed.sort()).toEqual(['A', 'A1', 'B', 'B1']);
      expect(keys(removed.items)).toEqual(['C@1', 'D@1']);
    });
  });

  describe('validateMove mirrors the server', () => {
    it('refuses a folder into itself or its own subtree (doc.tree.cycle)', () => {
      // Arrange
      const index = indexTree(sample());

      // Act / Assert
      expect(validateMove(index, 'A', { parent: 'A' })).toBe('doc.tree.cycle');
      expect(validateMove(index, 'A', { parent: 'B' })).toBe('doc.tree.cycle');
    });

    it('refuses a parent that is not a folder (doc.parent.invalid)', () => {
      expect(validateMove(indexTree(sample()), 'C', { parent: 'A1' })).toBe('doc.parent.invalid');
    });

    it('refuses a sibling title clash ignoring case (doc.title.duplicate)', () => {
      // Arrange
      const items = [...sample(), node('X', 'D', 'Page', 'overview')];
      const index = indexTree(applyMove(items, 'A', { position: 'Top' }));
      const clash = node('Y', null, 'Page', 'Overview');
      const withClash = indexTree(applyInsert(items, clash, { parent: 'root' }));

      // Act / Assert
      expect(validateMove(index, 'C', { parent: 'D' })).toBeNull();
      expect(validateMove(withClash, 'Y', { parent: 'D' })).toBe('doc.title.duplicate');
    });

    it('allows six levels and refuses a seventh, counting the moved subtree (doc.tree.depth)', () => {
      // Arrange: F1 > … > F5, plus a root folder G holding page P (height 2)
      const items = applyInsert(
        applyInsert(chain(5), node('G', null, 'Folder'), { parent: 'root' }),
        node('P', 'G'),
        { parent: 'G' },
      );
      const index = indexTree(items);

      // Act / Assert: P under F5 is depth 6; G (height 2) under F5 would reach depth 7
      expect(validateMove(index, 'P', { parent: 'F5' })).toBeNull();
      expect(validateMove(index, 'G', { parent: 'F4' })).toBeNull();
      expect(validateMove(index, 'G', { parent: 'F5' })).toBe('doc.tree.depth');
    });

    it('refuses a 501st doc in a folder (doc.tree.folderFull) but not a reorder inside it', () => {
      // Arrange
      let items: DocTreeItem[] = [node('F', null, 'Folder'), node('Z', null)];
      for (let i = 0; i < 500; i++) items.push(node(`P${i}`, 'F'));
      items = applyMove(items, 'F', { position: 'Top' });
      const index = indexTree(items);

      // Act / Assert
      expect(validateMove(index, 'Z', { parent: 'F' })).toBe('doc.tree.folderFull');
      expect(validateMove(index, 'P3', { parent: 'F', position: 'Top' })).toBeNull();
    });

    it('reports a move that changes nothing as noop', () => {
      // Arrange
      const index = indexTree(sample());

      // Act / Assert
      expect(validateMove(index, 'C', { parent: 'root', beforeKey: 'C' })).toBe('noop');
      expect(validateMove(index, 'C', { parent: 'root', afterKey: 'A' })).toBe('noop');
      expect(validateMove(index, 'A1', { parent: 'A', position: 'Top' })).toBe('noop');
      expect(validateMove(index, 'C', { parent: 'root', afterKey: 'D' })).toBeNull();
    });
  });

  describe('visibleRows', () => {
    it('hides the subtree of collapsed folders', () => {
      // Act
      const collapsed = visibleRows(sample(), new Set(), '');
      const expanded = visibleRows(sample(), new Set(['A']), '');

      // Assert
      expect(collapsed.map((r) => (r as NodeRow).item.key)).toEqual(['A', 'C', 'D']);
      expect(expanded.map((r) => (r as NodeRow).item.key)).toEqual(['A', 'A1', 'B', 'C', 'D']);
    });

    it('filters by title and shows the ancestors of matches expanded', () => {
      // Act
      const rows = visibleRows(sample(), new Set(), 'b1') as NodeRow[];

      // Assert
      expect(rows.map((r) => r.item.key)).toEqual(['A', 'B', 'B1']);
      expect(rows.map((r) => r.expanded)).toEqual([true, true, false]);
    });

    it('puts the inline create row at the end of its folder', () => {
      // Act
      const rows = visibleRows(sample(), new Set(['A', 'B']), '', {
        parentKey: 'A',
        kind: 'Page',
        diagramFormat: null,
      });

      // Assert
      expect(rows.map((r) => (r.type === 'node' ? r.item.key : `+${r.depth}`))).toEqual([
        'A',
        'A1',
        'B',
        'B1',
        '+2',
        'C',
        'D',
      ]);
    });

    it('lays out 2 000 nodes quickly', () => {
      // Arrange
      const items: DocTreeItem[] = [];
      for (let f = 0; f < 100; f++) {
        items.push(node(`F${f}`, null, 'Folder'));
        for (let p = 0; p < 19; p++) items.push(node(`F${f}P${p}`, `F${f}`));
      }
      const flat = applyMove(items, 'F0', { position: 'Top' });
      const expanded = new Set(flat.filter((i) => i.kind === 'Folder').map((i) => i.key));

      // Act
      const started = performance.now();
      const rows = visibleRows(flat, expanded, '');
      const elapsed = performance.now() - started;

      // Assert
      expect(rows).toHaveLength(2000);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('dropTargetAt', () => {
    const rows = () => visibleRows(sample(), new Set(['A']), '');

    it('drops before a page on its upper half and after it on the lower half', () => {
      // Act: row 4 is C (rows: A, A1, B, C, D)
      const before = dropTargetAt(rows(), 3 * 28 + 5, 28);
      const after = dropTargetAt(rows(), 3 * 28 + 20, 28);

      // Assert
      expect(before?.placement).toEqual({ parent: 'root', beforeKey: 'C' });
      expect(after?.placement).toEqual({ parent: 'root', afterKey: 'C' });
      expect(after?.lineIndex).toBe(4);
    });

    it('drops into a folder on its middle half', () => {
      // Act: row 3 is B (collapsed)
      const target = dropTargetAt(rows(), 2 * 28 + 14, 28);

      // Assert
      expect(target?.zone).toBe('inside');
      expect(target?.placement).toEqual({ parent: 'B', position: 'Bottom' });
      expect(target?.folderKey).toBe('B');
    });

    it('drops at the top of an open folder below its row, and at the root bottom past the end', () => {
      // Act
      const intoOpen = dropTargetAt(rows(), 0 * 28 + 25, 28);
      const end = dropTargetAt(rows(), 10 * 28, 28);

      // Assert
      expect(intoOpen?.placement).toEqual({ parent: 'A', position: 'Top' });
      expect(intoOpen?.lineDepth).toBe(2);
      expect(end?.placement).toEqual({ parent: 'root', position: 'Bottom' });
    });
  });

  it('reorders one step among siblings', () => {
    // Arrange
    const index = indexTree(sample());

    // Act / Assert
    expect(reorderPlacement(index, 'C', -1)).toEqual({ parent: 'root', beforeKey: 'A' });
    expect(reorderPlacement(index, 'C', 1)).toEqual({ parent: 'root', afterKey: 'D' });
    expect(reorderPlacement(index, 'D', 1)).toBeNull();
  });

  it('shows the comment count in the row tooltip of pages and diagrams only', () => {
    // Arrange
    const page = { ...node('P', null, 'Page', 'Design'), commentCount: 3 };
    const diagram = { ...node('G', null, 'Diagram', 'Flow'), commentCount: 1 };
    const quiet = node('Q', null, 'Page', 'Quiet');
    const folder = { ...node('F', null, 'Folder', 'Specs'), commentCount: 2 };

    // Act
    const tooltips = [page, diagram, quiet, folder].map(rowTooltip);

    // Assert
    expect(tooltips).toEqual(['Design\n3 comments', 'Flow\n1 comment', 'Quiet', 'Specs']);
  });
});
