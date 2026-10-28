/// The index a key moves the focus to in `count` items laid out `columns` per row (roving
/// tabindex): arrows in 2D without wrapping, Home/End to the ends; null for other keys.
export function rovingIndex(
  key: string,
  index: number,
  count: number,
  columns: number,
): number | null {
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, count - 1);
    case 'ArrowLeft':
      return Math.max(index - 1, 0);
    case 'ArrowDown':
      return index + columns < count ? index + columns : index;
    case 'ArrowUp':
      return index - columns >= 0 ? index - columns : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/// How many of `items` share the first one's row.
export function columnsOf(items: readonly HTMLElement[]): number {
  const top = items[0]?.offsetTop;
  const columns = items.findIndex((item) => item.offsetTop !== top);
  return columns < 0 ? Math.max(items.length, 1) : columns;
}
