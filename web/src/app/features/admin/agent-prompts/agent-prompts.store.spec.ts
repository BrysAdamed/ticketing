import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AgentInstanceStatus, InstanceAgentPromptSummary } from '@core/agent/agent-prompt.models';
import { AgentPromptsClient } from '@core/agent/agent-prompts.client';
import { AgentPromptsStore } from './agent-prompts.store';

function summary(slot: InstanceAgentPromptSummary['slot']): InstanceAgentPromptSummary {
  return {
    slot,
    type: slot === 'Guardrails' ? null : slot,
    version: 1,
    builtInVersion: '2026.10.1',
    followsBuiltIn: true,
    latestBuiltInVersion: '2026.10.1',
    newerBuiltInAvailable: false,
    overridingProjects: 0,
    updatedBy: null,
    updatedAt: '2026-10-27T10:00:00Z',
  };
}

const STATUS: AgentInstanceStatus = {
  publicUrlVariable: 'TICKETING_PUBLIC_URL',
  publicUrl: 'http://localhost:8090',
  delegationAvailable: true,
};

describe('AgentPromptsStore', () => {
  const client = {
    instanceStatus: vi.fn(),
    listInstance: vi.fn(),
  };

  function setup(): AgentPromptsStore {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AgentPromptsStore,
        { provide: AgentPromptsClient, useValue: client },
      ],
    });
    return TestBed.inject(AgentPromptsStore);
  }

  beforeEach(() => vi.resetAllMocks());

  it('loads the status and splits the prompts into types and guardrails', async () => {
    // Arrange
    client.instanceStatus.mockReturnValue(of(STATUS));
    client.listInstance.mockReturnValue(of([summary('Bug'), summary('Guardrails')]));
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(store.status()).toBe('loaded');
    expect(store.types().map((p) => p.slot)).toEqual(['Bug']);
    expect(store.guardrails()?.slot).toBe('Guardrails');
  });

  it('does not ask for the prompts while the public URL is unset', async () => {
    // Arrange
    client.instanceStatus.mockReturnValue(
      of({ ...STATUS, publicUrl: null, delegationAvailable: false }),
    );
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(store.status()).toBe('loaded');
    expect(store.instance()?.delegationAvailable).toBe(false);
    expect(store.prompts()).toBeNull();
    expect(client.listInstance).not.toHaveBeenCalled();
  });

  it('reports a 404 when the flag was turned off', async () => {
    // Arrange
    client.instanceStatus.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: { code: 'agent.disabled', title: 'Agent delegation is not available.' },
          }),
      ),
    );
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(store.status()).toBe('error');
    expect(store.error()?.isNotFound).toBe(true);
  });
});
