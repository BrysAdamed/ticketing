import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ApiError } from '../api/api-error';
import { ToastService } from '../notify/toast.service';
import {
  AgentPromptPreview,
  AgentPromptScope,
  InstanceAgentPrompt,
  ProjectAgentPrompt,
  SaveAgentPrompt,
} from './agent-prompt.models';
import { AgentPromptEditorStore, PREVIEW_DEBOUNCE_MS } from './agent-prompt-editor.store';
import { AgentPromptsClient } from './agent-prompts.client';

const PROJECT: AgentPromptScope = { kind: 'project', projectKey: 'TKT' };
const DEFAULT_BODY = 'Fix the bug {{ticket.key}}.';

function projectPrompt(overrides: Partial<ProjectAgentPrompt> = {}): ProjectAgentPrompt {
  return {
    type: 'Bug',
    mode: 'Inherit',
    version: 0,
    body: null,
    effectiveSource: 'Default',
    effectiveVersion: 3,
    effectiveBody: DEFAULT_BODY,
    defaultVersion: 3,
    defaultBody: DEFAULT_BODY,
    basedOnDefaultVersion: null,
    defaultChanged: false,
    guardrailsVersion: 1,
    guardrails: 'Rules.',
    updatedBy: null,
    updatedAt: null,
    ...overrides,
  };
}

function preview(prompt: string, overrides: Partial<AgentPromptPreview> = {}): AgentPromptPreview {
  return {
    prompt,
    length: prompt.length,
    lengthLimit: 4500,
    ticketKey: 'TKT-1234',
    errors: [],
    guardrailsStart: null,
    ...overrides,
  };
}

class FakeClient {
  stored = projectPrompt();
  getProject = vi.fn(() => of(this.stored));
  getInstance = vi.fn();
  placeholders = vi.fn(() => of([{ name: 'ticket.key', description: 'The key.' }]));
  preview = vi.fn(
    (_scope: AgentPromptScope, _slot: string, body: string | null, _ticket: string | null) =>
      of(preview(body ?? DEFAULT_BODY)) as Observable<AgentPromptPreview>,
  );
  save = vi.fn((_scope: AgentPromptScope, _slot: string, request: SaveAgentPrompt) => {
    this.stored = projectPrompt({
      mode: request.mode,
      body: request.body,
      version: this.stored.version + 1,
      effectiveBody: request.mode === 'Custom' ? request.body : DEFAULT_BODY,
    });
    return of(this.stored) as Observable<ProjectAgentPrompt | InstanceAgentPrompt>;
  });
  resetProject = vi.fn();
  versions = vi.fn(() => of([]));
  version = vi.fn();
  restore = vi.fn();
}

describe('AgentPromptEditorStore', () => {
  let client: FakeClient;
  let toast: {
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  let store: AgentPromptEditorStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    client = new FakeClient();
    toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AgentPromptEditorStore,
        { provide: AgentPromptsClient, useValue: client },
        { provide: ToastService, useValue: toast },
      ],
    });
    store = TestBed.inject(AgentPromptEditorStore);
    store.setEditable(true);
  });

  afterEach(() => vi.useRealTimers());

  it('opens a slot with the sample ticket and previews the default text', async () => {
    // Act
    await store.open(PROJECT, 'Bug', () => Promise.resolve('TKT-7'));
    await vi.runAllTimersAsync();

    // Assert
    expect(store.status()).toBe('loaded');
    expect(store.mode()).toBe('Inherit');
    expect(store.dirty()).toBe(false);
    expect(store.previewTicketKey()).toBe('TKT-7');
    expect(client.preview).toHaveBeenCalledExactlyOnceWith(PROJECT, 'Bug', null, 'TKT-7');
    expect(store.placeholders().map((p) => p.name)).toEqual(['ticket.key']);
  });

  it('starts a custom prompt from the default text and tracks changes', async () => {
    // Arrange
    await store.open(PROJECT, 'Bug');

    // Act
    store.setMode('Custom');
    const seeded = store.body();
    store.edit(`${seeded} More.`);

    // Assert
    expect(seeded).toBe(DEFAULT_BODY);
    expect(store.dirty()).toBe(true);
    store.discard();
    expect(store.dirty()).toBe(false);
    expect(store.mode()).toBe('Inherit');
  });

  it('debounces the preview while typing and renders only the last text', async () => {
    // Arrange
    await store.open(PROJECT, 'Bug');
    store.setMode('Custom');
    await vi.runAllTimersAsync();
    client.preview.mockClear();

    // Act
    store.edit('a');
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 100);
    store.edit('ab');
    vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS - 100);
    store.edit('abc');
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);

    // Assert
    expect(client.preview).toHaveBeenCalledExactlyOnceWith(PROJECT, 'Bug', 'abc', null);
    expect(store.preview()?.prompt).toBe('abc');
    expect(store.previewPending()).toBe(false);
  });

  it('drops a preview answer that arrives after a newer one was requested', async () => {
    // Arrange
    await store.open(PROJECT, 'Bug');
    store.setMode('Custom');
    await vi.runAllTimersAsync();
    const slow = new Subject<AgentPromptPreview>();
    client.preview.mockReturnValueOnce(slow);
    store.edit('old');
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);

    // Act
    store.edit('new');
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
    slow.next(preview('old'));
    slow.complete();
    await vi.runAllTimersAsync();

    // Assert
    expect(store.preview()?.prompt).toBe('new');
  });

  it('estimates the length from the last preview while the next one is pending', async () => {
    // Arrange
    client.preview.mockImplementation((_s, _t, body) =>
      of(
        preview(`${body ?? DEFAULT_BODY}\n\nRules.`, {
          guardrailsStart: (body ?? DEFAULT_BODY).length + 2,
        }),
      ),
    );
    await store.open(PROJECT, 'Bug');
    store.setMode('Custom');
    await vi.runAllTimersAsync();
    const rendered = store.length();

    // Act
    store.edit(`${store.body()}12345`);

    // Assert
    expect(store.length()).toBe(rendered + 5);
    expect(store.lengthEstimated()).toBe(true);
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
    expect(store.lengthEstimated()).toBe(false);
  });

  it('exposes positioned template errors from the preview only in Custom mode', async () => {
    // Arrange
    client.preview.mockImplementation((_s, _t, body) =>
      of(
        preview('', {
          prompt: body === null ? DEFAULT_BODY : null,
          errors:
            body === null
              ? []
              : [
                  {
                    code: 'agent.template.unknownPlaceholder',
                    message: 'Unknown',
                    line: 1,
                    column: 3,
                  },
                ],
        }),
      ),
    );
    await store.open(PROJECT, 'Bug');

    // Act
    store.setMode('Custom');
    store.edit('x {{nope}}');
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);

    // Assert
    expect(store.hasTemplateErrors()).toBe(true);
    store.setMode('Inherit');
    expect(store.issues()).toEqual([]);
  });

  it('saves the draft with the base version and change note as a new version', async () => {
    // Arrange
    await store.open(PROJECT, 'Bug');
    store.setMode('Custom');
    store.edit('Custom {{ticket.key}}');
    store.changeNote.set('  tighter  ');

    // Act
    const saved = await store.save();

    // Assert
    expect(saved).toBe(true);
    expect(client.save).toHaveBeenCalledWith(PROJECT, 'Bug', {
      mode: 'Custom',
      body: 'Custom {{ticket.key}}',
      changeNote: 'tighter',
      baseVersion: 0,
    });
    expect(store.document()?.version).toBe(1);
    expect(store.dirty()).toBe(false);
    expect(store.changeNote()).toBe('');
  });

  it('checks the text being saved for template errors before saving', async () => {
    // Arrange
    client.preview.mockImplementation((_s, _t, body) =>
      of(
        preview(body ?? DEFAULT_BODY, {
          prompt: body?.includes('nope') ? null : (body ?? DEFAULT_BODY),
          errors: body?.includes('nope')
            ? [
                {
                  code: 'agent.template.unknownPlaceholder',
                  message: 'Unknown',
                  line: 1,
                  column: 1,
                },
              ]
            : [],
        }),
      ),
    );
    await store.open(PROJECT, 'Bug');
    store.setMode('Custom');
    store.edit('{{nope}}');
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);

    // Act
    const blocked = await store.save();
    store.edit('Fixed {{ticket.key}}');
    const saved = await store.save();

    // Assert
    expect(blocked).toBe(false);
    expect(toast.warning).toHaveBeenCalledWith('Fix the template errors before saving.');
    expect(saved).toBe(true);
    expect(client.save).toHaveBeenCalledOnce();
  });

  it('does not save for readers', async () => {
    // Arrange
    await store.open(PROJECT, 'Bug');
    store.setEditable(false);
    store.setMode('Off');

    // Act
    const saved = await store.save();

    // Assert
    expect(saved).toBe(false);
    expect(client.save).not.toHaveBeenCalled();
  });

  it('reloads the latest version on a version conflict and keeps the edit to apply again', async () => {
    // Arrange
    await store.open(PROJECT, 'Bug');
    store.setMode('Custom');
    store.edit('Mine');
    client.stored = projectPrompt({
      mode: 'Custom',
      body: 'Theirs',
      version: 2,
      effectiveBody: 'Theirs',
    });
    client.save.mockReturnValueOnce(
      throwError(() => new ApiError(409, 'agent.prompt.versionConflict', 'Conflict')),
    );

    // Act
    const saved = await store.save();

    // Assert
    expect(saved).toBe(false);
    expect(store.body()).toBe('Theirs');
    expect(store.document()?.version).toBe(2);
    expect(store.lostEdit()).toEqual({ mode: 'Custom', body: 'Mine', latestVersion: 2 });
    expect(toast.warning).toHaveBeenCalled();

    store.reapplyLostEdit();
    expect(store.body()).toBe('Mine');
    expect(store.dirty()).toBe(true);
    await store.save();
    expect(client.save).toHaveBeenLastCalledWith(
      PROJECT,
      'Bug',
      expect.objectContaining({ baseVersion: 2 }),
    );
  });

  it('marks a custom prompt as reviewed by saving it again against the current default', async () => {
    // Arrange
    client.stored = projectPrompt({
      mode: 'Custom',
      body: 'Mine',
      version: 4,
      effectiveBody: 'Mine',
      defaultChanged: true,
      defaultVersion: 5,
    });
    await store.open(PROJECT, 'Bug');

    // Act
    await store.markReviewed();

    // Assert
    expect(client.save).toHaveBeenCalledWith(PROJECT, 'Bug', {
      mode: 'Custom',
      body: 'Mine',
      changeNote: 'Reviewed against default v5',
      baseVersion: 4,
    });
  });

  it('maps an instance slot to a custom document compared with the built-in', async () => {
    // Arrange
    const instance: InstanceAgentPrompt = {
      slot: 'Guardrails',
      type: null,
      version: 2,
      body: 'Rules.',
      builtInVersion: null,
      followsBuiltIn: false,
      latestBuiltInVersion: '2026.10.1',
      newerBuiltInAvailable: true,
      builtInBody: 'Built-in rules.',
      overridingProjects: 0,
      updatedBy: null,
      updatedAt: '2026-10-27T00:00:00Z',
    };
    client.getInstance.mockReturnValue(of(instance));

    // Act
    await store.open({ kind: 'instance' }, 'Guardrails');
    store.edit('');

    // Assert
    expect(store.mode()).toBe('Custom');
    expect(store.document()?.reference).toEqual({
      label: 'Built-in 2026.10.1',
      body: 'Built-in rules.',
    });
    expect(store.document()?.referenceChanged).toBe(true);
    expect(store.canSave()).toBe(true);
  });
});
