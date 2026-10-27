import { ApiError } from '@core/api/api-error';
import { ResolvedAgentPrompt } from '@core/agent/agent-delegation.client';
import { CLAUDE_PROMPT_LIMIT, normalizePrompt } from '@core/agent/claude-deep-link';
import { ProjectDetail } from '@core/projects/project-context';
import { Ticket } from '@core/tickets/ticket.models';

export type PromptLoad =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; prompt: ResolvedAgentPrompt }
  | { status: 'error'; error: ApiError };

/// What the Delegate button shows (refinement §1.8 as revised in §6, D-100).
export type DelegateState =
  /// Flag off or no public URL (`project.agent` null), archived project, Viewer, type Off, or a
  /// Member on a project without delegation.
  | { kind: 'hidden' }
  /// An Owner on a project without delegation: disabled, with a link to the Agent settings.
  | { kind: 'setup' }
  | { kind: 'loading' }
  | { kind: 'ready'; prompt: ResolvedAgentPrompt }
  /// Done tickets: disabled, but Copy and Preview still work.
  | { kind: 'done'; prompt: ResolvedAgentPrompt }
  /// Over Claude's 5,000 characters; `prompt` is null when the server already refused it.
  | { kind: 'tooLong'; length: number | null; prompt: ResolvedAgentPrompt | null }
  | { kind: 'error'; message: string };

const HIDING_CODES = new Set([
  'agent.disabled',
  'agent.unavailable',
  'agent.type.off',
  'ticket.notFound',
  'ticket.deleted',
]);

/// Whether the resolved prompt is worth loading for this ticket at all.
export function needsPrompt(ticket: Ticket, project: ProjectDetail | null): boolean {
  const agent = project?.agent;
  return !!agent?.enabled && !project?.archivedAt && canDelegate(ticket);
}

export function delegateState(
  ticket: Ticket,
  project: ProjectDetail | null,
  load: PromptLoad,
): DelegateState {
  const agent = project?.agent;
  if (!project || !agent || project.archivedAt || !canDelegate(ticket)) return { kind: 'hidden' };
  if (!agent.enabled) return setupOrHidden(ticket);

  switch (load.status) {
    case 'idle':
    case 'loading':
      return { kind: 'loading' };
    case 'error':
      if (HIDING_CODES.has(load.error.code)) return { kind: 'hidden' };
      if (load.error.code === 'agent.project.disabled') return setupOrHidden(ticket);
      if (load.error.code === 'agent.prompt.tooLong')
        return { kind: 'tooLong', length: null, prompt: null };
      return { kind: 'error', message: load.error.title };
    case 'loaded': {
      const length = normalizePrompt(load.prompt.prompt).length;
      if (ticket.status === 'Done') return { kind: 'done', prompt: load.prompt };
      if (length > CLAUDE_PROMPT_LIMIT) return { kind: 'tooLong', length, prompt: load.prompt };
      return { kind: 'ready', prompt: load.prompt };
    }
  }
}

/// The prompt Copy and Preview can use in this state, if any.
export function availablePrompt(state: DelegateState): ResolvedAgentPrompt | null {
  return state.kind === 'ready' || state.kind === 'done' || state.kind === 'tooLong'
    ? state.prompt
    : null;
}

/// Why Delegate is not available right now, for tooltips and the `Shift+D` toast.
export function disabledReason(state: DelegateState): string | null {
  switch (state.kind) {
    case 'setup':
      return 'Agent delegation is off for this project';
    case 'loading':
      return 'Loading the agent prompt…';
    case 'done':
      return 'Reopen the ticket to delegate it';
    case 'tooLong':
      return state.length === null
        ? 'This prompt is too long to open in Claude Code'
        : `This prompt is too long to open in Claude Code (${state.length.toLocaleString('en-US')} / ${CLAUDE_PROMPT_LIMIT.toLocaleString('en-US')} characters)`;
    case 'error':
      return `Couldn't load the agent prompt: ${state.message}`;
    default:
      return null;
  }
}

function canDelegate(ticket: Ticket): boolean {
  return ticket.myRole === 'Owner' || ticket.myRole === 'Member';
}

function setupOrHidden(ticket: Ticket): DelegateState {
  return ticket.myRole === 'Owner' ? { kind: 'setup' } : { kind: 'hidden' };
}
