import { ApiError } from '@core/api/api-error';
import { ResolvedAgentPrompt } from '@core/agent/agent-delegation.client';
import { ProjectAgentSettings, ProjectDetail } from '@core/projects/project-context';
import { Ticket } from '@core/tickets/ticket.models';
import { ProjectRole, TicketStatus } from '@shared/domain/enums';
import { delegateState, disabledReason, needsPrompt, PromptLoad } from './delegate-state';

const agent: ProjectAgentSettings = {
  enabled: true,
  repositoryUrl: 'https://git.example.com/team/app.git',
  normalizedRepositoryUrl: 'git.example.com/team/app',
  defaultBranch: 'main',
  mergePolicy: 'Review',
  assignOnDelegate: true,
  startProgressOnDelegate: true,
  rowVersion: 7,
};

const resolved: ResolvedAgentPrompt = {
  prompt: 'Fix the bug APP-1.',
  ticketKey: 'APP-1',
  ticketType: 'Bug',
  template: { source: 'Default', version: 1, updatedAt: '2026-10-27T10:00:00Z', updatedBy: null },
  guardrailsVersion: 1,
  outsiderContent: null,
};

function ticket(myRole: ProjectRole = 'Member', status: TicketStatus = 'ToDo'): Ticket {
  return { key: 'APP-1', projectKey: 'APP', type: 'Bug', myRole, status } as Ticket;
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return { key: 'APP', archivedAt: null, agent, ...overrides } as ProjectDetail;
}

function failed(code: string): PromptLoad {
  return { status: 'error', error: { code, title: `failed ${code}` } as ApiError };
}

const loaded: PromptLoad = { status: 'loaded', prompt: resolved };

describe('delegateState', () => {
  it.each([
    ['the flag is off or the public URL unset', ticket(), project({ agent: null })],
    ['the project is archived', ticket('Owner'), project({ archivedAt: '2026-10-01T00:00:00Z' })],
    ['the caller is a Viewer', ticket('Viewer'), project()],
    [
      'a Member looks at a project without delegation',
      ticket(),
      project({ agent: { ...agent, enabled: false } }),
    ],
    ['the project is still loading', ticket(), null],
  ])('is hidden when %s', (_, t, p) => {
    // Act / Assert
    expect(delegateState(t, p, loaded)).toEqual({ kind: 'hidden' });
  });

  it('is hidden when the ticket type is Off', () => {
    // Act / Assert
    expect(delegateState(ticket(), project(), failed('agent.type.off'))).toEqual({
      kind: 'hidden',
    });
  });

  it('asks Owners to set up a project without delegation', () => {
    // Act
    const state = delegateState(ticket('Owner'), project({ agent: { ...agent, enabled: false } }), {
      status: 'idle',
    });

    // Assert
    expect(state).toEqual({ kind: 'setup' });
    expect(disabledReason(state)).toBe('Agent delegation is off for this project');
  });

  it('is disabled for Done tickets but keeps the prompt for Copy', () => {
    // Act
    const state = delegateState(ticket('Member', 'Done'), project(), loaded);

    // Assert
    expect(state).toEqual({ kind: 'done', prompt: resolved });
    expect(disabledReason(state)).toBe('Reopen the ticket to delegate it');
  });

  it('refuses prompts over 5,000 characters and reports the count', () => {
    // Arrange
    const long = { ...resolved, prompt: 'x'.repeat(5001) };

    // Act
    const state = delegateState(ticket(), project(), { status: 'loaded', prompt: long });

    // Assert
    expect(state).toEqual({ kind: 'tooLong', length: 5001, prompt: long });
    expect(disabledReason(state)).toContain('(5,001 / 5,000 characters)');
  });

  it('is loading, then ready, for a writer on an enabled project', () => {
    // Act / Assert
    expect(delegateState(ticket(), project(), { status: 'loading' })).toEqual({ kind: 'loading' });
    expect(delegateState(ticket(), project(), loaded)).toEqual({ kind: 'ready', prompt: resolved });
  });

  it('shows other errors as a disabled button with the message', () => {
    // Act
    const state = delegateState(ticket(), project(), failed('server.error'));

    // Assert
    expect(state).toEqual({ kind: 'error', message: 'failed server.error' });
  });
});

describe('needsPrompt', () => {
  it('loads the prompt only for writers on enabled, active projects', () => {
    // Act / Assert
    expect(needsPrompt(ticket(), project())).toBe(true);
    expect(needsPrompt(ticket('Viewer'), project())).toBe(false);
    expect(needsPrompt(ticket(), project({ agent: { ...agent, enabled: false } }))).toBe(false);
    expect(needsPrompt(ticket(), project({ archivedAt: '2026-10-01T00:00:00Z' }))).toBe(false);
    expect(needsPrompt(ticket(), project({ agent: null }))).toBe(false);
  });
});
