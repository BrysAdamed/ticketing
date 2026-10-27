/// Multi-select over an ordered list of ids: plain click selects one, Ctrl/⌘ or the checkbox
/// toggles, Shift selects the range from the anchor (layout-and-screens §3.2).
export interface SelectionState {
  readonly selected: ReadonlySet<string>;
  readonly anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

export type SelectMode = 'single' | 'toggle' | 'range';

export function select(
  state: SelectionState,
  order: readonly string[],
  id: string,
  mode: SelectMode,
): SelectionState {
  switch (mode) {
    case 'toggle': {
      const selected = new Set(state.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { selected, anchor: id };
    }
    case 'range': {
      const anchor = state.anchor && order.includes(state.anchor) ? state.anchor : id;
      const from = order.indexOf(anchor);
      const to = order.indexOf(id);
      const [start, end] = from <= to ? [from, to] : [to, from];
      const selected = new Set(state.selected);
      for (const rangeId of order.slice(start, end + 1)) selected.add(rangeId);
      return { selected, anchor };
    }
    default:
      return { selected: new Set([id]), anchor: id };
  }
}

export function selectAll(order: readonly string[]): SelectionState {
  return { selected: new Set(order), anchor: order[0] ?? null };
}

/// Drops ids that are no longer visible (after filtering or a refetch).
export function prune(state: SelectionState, visible: readonly string[]): SelectionState {
  const set = new Set(visible);
  const selected = new Set([...state.selected].filter((id) => set.has(id)));
  if (selected.size === state.selected.size) return state;
  return { selected, anchor: state.anchor && set.has(state.anchor) ? state.anchor : null };
}

/// The ids to act on, in list order: the selection when it contains `focusId`, otherwise just `focusId`.
export function targets(
  state: SelectionState,
  order: readonly string[],
  focusId: string | null,
): string[] {
  if (focusId && !state.selected.has(focusId)) return [focusId];
  return order.filter((id) => state.selected.has(id));
}

/// j/k navigation: the next or previous id, clamped to the list.
export function step(
  order: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const index = current ? order.indexOf(current) : -1;
  if (index < 0) return delta > 0 ? order[0] : order[order.length - 1];
  return order[Math.min(order.length - 1, Math.max(0, index + delta))];
}
