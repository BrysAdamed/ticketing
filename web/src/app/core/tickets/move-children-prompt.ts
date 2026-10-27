import { MoveChildrenPreview } from './ticket.models';

/// The place the moved tickets leave. A board without a name reads "on this board".
export type MoveSource = { kind: 'backlog' } | { kind: 'board'; name?: string };

/// Where the moved tickets go.
export type MoveDestination = { kind: 'backlog' } | { kind: 'board'; name: string };

export interface MoveChildrenPromptText {
  title: string;
  message: string;
  /// The sub-tickets that stay behind, e.g. "2 are on another board, 1 is Done"; null when none.
  detail: string | null;
}

/// Whether a move may take sub-tickets along, from the child counts already loaded (backlog rows,
/// board cards, the ticket's children): only then is the preview worth a request.
export function mayHaveChildren(childCounts: readonly number[]): boolean {
  return childCounts.some((count) => count > 0);
}

/// The question to ask before a move, or null when no selected ticket has sub-tickets that would
/// come along (then the move goes ahead without asking).
export function moveChildrenPrompt(
  preview: MoveChildrenPreview,
  source: MoveSource,
  destination: MoveDestination,
): MoveChildrenPromptText | null {
  const count = preview.count;
  if (count <= 0) return null;
  const withChildren = preview.parents.filter((p) => p.children.length > 0);
  const parents = withChildren.length ? withChildren : preview.parents;
  const subject = parents.length === 1 ? parents[0].key : `${parents.length} selected tickets`;
  const verb = parents.length === 1 ? 'has' : 'have';
  const where = source.kind === 'backlog' ? 'in the backlog' : `on ${source.name ?? 'this board'}`;
  const target = destination.kind === 'backlog' ? 'the backlog' : destination.name;
  return {
    title: 'Move sub-tickets too?',
    message:
      `${subject} ${verb} ${count} ${plural(count, 'sub-ticket', 'sub-tickets')} ${where}. ` +
      `Move ${count === 1 ? 'it' : 'them'} to ${target} too?`,
    detail: skippedChildren(preview),
  };
}

/// "2 are on another board, 1 is in the backlog, 1 is Done", leaving out zero parts; null when
/// nothing is skipped.
export function skippedChildren(
  skipped: Pick<MoveChildrenPreview, 'onOtherBoard' | 'inBacklog' | 'done'>,
): string | null {
  const parts = [
    [skipped.onOtherBoard, 'on another board'],
    [skipped.inBacklog, 'in the backlog'],
    [skipped.done, 'Done'],
  ] as const;
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${plural(n, 'is', 'are')} ${what}`)
    .join(', ');
  return text || null;
}

/// Keys of the sub-tickets that would come along, in placement order.
export function childKeys(preview: MoveChildrenPreview): string[] {
  return preview.parents.flatMap((p) => p.children.map((c) => c.key));
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
