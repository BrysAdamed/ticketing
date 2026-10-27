import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { ApiError, toApiError } from '../api/api-error';
import { ToastService } from '../notify/toast.service';
import { LoadStatus } from '../projects/project-directory';
import { UserRef } from '../tickets/ticket.models';
import {
  AGENT_PROMPT_LENGTH_LIMIT,
  AGENT_PROMPT_VERSION_CONFLICT,
  AgentPromptIssue,
  AgentPromptMode,
  AgentPromptPlaceholder,
  AgentPromptPreview,
  AgentPromptScope,
  AgentPromptSlot,
  AgentPromptVersion,
  AgentPromptVersionSummary,
  InstanceAgentPrompt,
  ProjectAgentPrompt,
} from './agent-prompt.models';
import { AgentPromptsClient } from './agent-prompts.client';

export const PREVIEW_DEBOUNCE_MS = 400;

/// The text a prompt is compared with: the instance default for a project type, the shipped
/// built-in for an instance slot.
export interface AgentPromptReference {
  label: string;
  body: string;
}

/// A loaded prompt slot in the shape the editor needs, whatever its scope. `raw` is the server DTO
/// for scope-specific details (guardrails version, overriding projects, …).
export interface AgentPromptDocument {
  version: number;
  mode: AgentPromptMode;
  body: string | null;
  effectiveBody: string | null;
  reference: AgentPromptReference;
  referenceChanged: boolean;
  updatedBy: UserRef | null;
  updatedAt: string | null;
  raw: ProjectAgentPrompt | InstanceAgentPrompt;
}

/// The edit that lost a version conflict, kept so the user can apply it again on the latest version.
export interface LostEdit {
  mode: AgentPromptMode;
  body: string;
  latestVersion: number;
}

/// Editor state of one prompt slot, for a project type or an instance slot (`open(scope, slot)`).
/// Holds the saved document and the draft (mode, body, change note); renders a server preview
/// 400 ms after the last change (out-of-order answers are dropped); saves with `baseVersion` and, on
/// `agent.prompt.versionConflict`, reloads the latest version and keeps the lost edit for
/// `reapplyLostEdit()`. History, reset and restore are new versions on the server. Provide it in the
/// editor view; call `setEditable` with the caller's permission.
@Injectable()
export class AgentPromptEditorStore {
  private readonly client = inject(AgentPromptsClient);
  private readonly toast = inject(ToastService);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewToken = 0;
  private loadToken = 0;
  private readonly versionBodies = new Map<number, AgentPromptVersion>();

  readonly scope = signal<AgentPromptScope | null>(null);
  readonly slot = signal<AgentPromptSlot | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly document = signal<AgentPromptDocument | null>(null);
  readonly editable = signal(false);

  readonly mode = signal<AgentPromptMode>('Inherit');
  readonly body = signal('');
  readonly changeNote = signal('');
  readonly saving = signal(false);
  readonly lostEdit = signal<LostEdit | null>(null);

  readonly placeholders = signal<AgentPromptPlaceholder[]>([]);
  readonly previewTicketKey = signal<string | null>(null);
  readonly preview = signal<AgentPromptPreview | null>(null);
  /// The body the shown preview was rendered from (null: the stored or default text).
  readonly previewedBody = signal<string | null>(null);
  readonly previewPending = signal(false);
  readonly previewError = signal<ApiError | null>(null);

  readonly versions = signal<AgentPromptVersionSummary[] | null>(null);
  readonly versionsLoading = signal(false);

  readonly isProject = computed(() => this.scope()?.kind === 'project');
  readonly dirty = computed(() => {
    const document = this.document();
    if (!document) return false;
    if (this.mode() !== document.mode) return true;
    return this.mode() === 'Custom' && this.body() !== (document.body ?? '');
  });
  /// Template problems of the latest preview, shown in the editor while it is in Custom mode.
  readonly issues = computed<AgentPromptIssue[]>(() =>
    this.mode() === 'Custom' ? (this.preview()?.errors ?? []) : [],
  );
  readonly hasTemplateErrors = computed(() => this.issues().some((i) => i.line !== null));
  readonly limit = computed(() => this.preview()?.lengthLimit ?? AGENT_PROMPT_LENGTH_LIMIT);
  /// The whole prompt's length, guardrails included: the server's figure, adjusted by how much the
  /// body changed since that preview so the count follows typing.
  readonly length = computed(() => {
    const preview = this.preview();
    if (this.mode() !== 'Custom') return preview?.length ?? 0;
    if (!preview) return this.body().length;
    return Math.max(0, preview.length + this.body().length - (this.previewedBody()?.length ?? 0));
  });
  readonly lengthEstimated = computed(
    () =>
      this.previewPending() || (this.mode() === 'Custom' && this.previewedBody() !== this.body()),
  );
  readonly overLimit = computed(() => this.length() >= this.limit());
  readonly canSave = computed(
    () =>
      this.editable() &&
      this.dirty() &&
      !this.saving() &&
      !(this.mode() === 'Custom' && !this.body().trim() && this.slot() !== 'Guardrails'),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelPreview());
  }

  /// Loads a slot. `sampleTicket` picks the ticket the first preview renders (null: a synthetic one).
  async open(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
    sampleTicket: () => Promise<string | null> = () => Promise.resolve(null),
  ): Promise<void> {
    this.cancelPreview();
    this.previewTicketKey.set(null);
    this.scope.set(scope);
    this.slot.set(slot);
    this.document.set(null);
    this.versions.set(null);
    this.versionBodies.clear();
    this.lostEdit.set(null);
    this.preview.set(null);
    this.previewedBody.set(null);
    this.changeNote.set('');
    this.error.set(null);
    this.status.set('loading');
    void this.loadPlaceholders();
    const token = ++this.loadToken;
    try {
      const [document, ticketKey] = await Promise.all([
        this.fetch(scope, slot),
        sampleTicket().catch(() => null),
      ]);
      if (token !== this.loadToken) return;
      this.apply(document);
      this.previewTicketKey.set(ticketKey);
      this.status.set('loaded');
      void this.refreshPreview();
    } catch (error) {
      if (token !== this.loadToken) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  setEditable(editable: boolean): void {
    this.editable.set(editable);
  }

  setMode(mode: AgentPromptMode): void {
    if (mode === this.mode()) return;
    const document = this.document();
    if (mode === 'Custom' && !this.body().trim() && document)
      this.body.set(document.body ?? document.effectiveBody ?? document.reference.body);
    this.mode.set(mode);
    void this.refreshPreview();
  }

  edit(body: string): void {
    this.body.set(body);
    this.schedulePreview();
  }

  setPreviewTicket(ticketKey: string | null): void {
    this.previewTicketKey.set(ticketKey);
    void this.refreshPreview();
  }

  /// Renders the draft now. Off renders nothing; Use default renders the default text.
  async refreshPreview(): Promise<void> {
    this.cancelPreview();
    const scope = this.scope();
    const slot = this.slot();
    if (!scope || !slot || !this.document()) return;
    const token = ++this.previewToken;
    if (this.mode() === 'Off') {
      this.preview.set(null);
      this.previewedBody.set(null);
      this.previewPending.set(false);
      return;
    }
    const body = this.mode() === 'Custom' ? this.body() : null;
    this.previewPending.set(true);
    try {
      const preview = await firstValueFrom(
        this.client.preview(scope, slot, body, this.previewTicketKey()),
      );
      if (token !== this.previewToken) return;
      this.preview.set(preview);
      this.previewedBody.set(body);
      this.previewError.set(null);
    } catch (error) {
      if (token !== this.previewToken) return;
      this.previewError.set(toApiError(error));
    } finally {
      if (token === this.previewToken) this.previewPending.set(false);
    }
  }

  /// Saves the draft as a new version. Resolves true when saved.
  /// Template errors block the save; they are checked on a preview of the text being saved.
  async save(): Promise<boolean> {
    const document = this.document();
    if (!document || !this.canSave()) return false;
    const mode = this.mode();
    if (mode === 'Custom') {
      if (this.previewPending() || this.previewedBody() !== this.body())
        await this.refreshPreview();
      if (this.hasTemplateErrors()) {
        this.toast.warning('Fix the template errors before saving.');
        return false;
      }
    }
    return this.write(
      () =>
        this.client.save(this.scope()!, this.slot()!, {
          mode,
          body: mode === 'Custom' ? this.body() : null,
          changeNote: this.changeNote().trim() || null,
          baseVersion: document.version,
        }),
      'Prompt saved.',
    );
  }

  /// Project: back to the instance default. Instance: back to the shipped built-in.
  async reset(): Promise<boolean> {
    const document = this.document();
    const scope = this.scope();
    if (!document || !scope || !this.editable()) return false;
    const request = { changeNote: this.changeNote().trim() || null, baseVersion: document.version };
    return this.write(
      () =>
        scope.kind === 'project'
          ? this.client.resetProject(scope.projectKey, this.slot()!, request)
          : this.client.resetInstanceToBuiltIn(this.slot()!, request),
      scope.kind === 'project' ? 'Back to the default prompt.' : 'Back to the built-in prompt.',
    );
  }

  /// Keeps the custom text but records that it was compared with the current reference: saves it
  /// again as a new version, which moves its `basedOnDefaultVersion` to the current default (D-101).
  async markReviewed(): Promise<boolean> {
    const document = this.document();
    if (!document || !this.editable() || this.dirty() || document.mode !== 'Custom') return false;
    return this.write(
      () =>
        this.client.save(this.scope()!, this.slot()!, {
          mode: document.mode,
          body: document.body,
          changeNote: `Reviewed against ${document.reference.label.toLowerCase()}`,
          baseVersion: document.version,
        }),
      'Marked as reviewed.',
    );
  }

  /// Makes version `number` current again as a new version.
  async restore(number: number): Promise<boolean> {
    const document = this.document();
    if (!document || !this.editable()) return false;
    this.saving.set(true);
    try {
      await firstValueFrom(
        this.client.restore(this.scope()!, this.slot()!, number, {
          changeNote: this.changeNote().trim() || null,
          baseVersion: document.version,
        }),
      );
      this.apply(await this.fetch(this.scope()!, this.slot()!));
      this.changeNote.set('');
      void this.loadVersions();
      void this.refreshPreview();
      this.toast.success(`Version ${number} restored as version ${this.document()!.version}.`);
      return true;
    } catch (error) {
      await this.handleWriteError(toApiError(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  discard(): void {
    const document = this.document();
    if (!document) return;
    this.apply(document);
    void this.refreshPreview();
  }

  reapplyLostEdit(): void {
    const lost = this.lostEdit();
    if (!lost) return;
    this.mode.set(lost.mode);
    this.body.set(lost.body);
    this.lostEdit.set(null);
    void this.refreshPreview();
  }

  dismissLostEdit(): void {
    this.lostEdit.set(null);
  }

  async loadVersions(): Promise<void> {
    const scope = this.scope();
    const slot = this.slot();
    if (!scope || !slot) return;
    this.versionsLoading.set(true);
    try {
      this.versions.set(await firstValueFrom(this.client.versions(scope, slot)));
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.versionsLoading.set(false);
    }
  }

  /// One version with its body (cached: versions never change).
  async version(number: number): Promise<AgentPromptVersion> {
    const cached = this.versionBodies.get(number);
    if (cached) return cached;
    const version = await firstValueFrom(this.client.version(this.scope()!, this.slot()!, number));
    this.versionBodies.set(number, version);
    return version;
  }

  private async write(
    request: () => Observable<ProjectAgentPrompt | InstanceAgentPrompt>,
    message: string,
  ): Promise<boolean> {
    this.saving.set(true);
    try {
      const saved = await firstValueFrom(request());
      this.apply(toDocument(this.scope()!, saved));
      this.changeNote.set('');
      if (this.versions()) void this.loadVersions();
      void this.refreshPreview();
      this.toast.success(message);
      return true;
    } catch (error) {
      await this.handleWriteError(toApiError(error));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private async handleWriteError(error: ApiError): Promise<void> {
    if (error.code !== AGENT_PROMPT_VERSION_CONFLICT) {
      this.toast.error(error);
      if (error.isValidation) void this.refreshPreview();
      return;
    }
    const lost = { mode: this.mode(), body: this.body() };
    try {
      this.apply(await this.fetch(this.scope()!, this.slot()!));
    } catch (reloadError) {
      this.toast.error(reloadError);
      return;
    }
    if (this.versions()) void this.loadVersions();
    void this.refreshPreview();
    this.lostEdit.set({ ...lost, latestVersion: this.document()!.version });
    this.toast.warning(
      'Someone else changed this prompt. The latest version is shown; your edit can be applied again.',
    );
  }

  private async fetch(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
  ): Promise<AgentPromptDocument> {
    const raw =
      scope.kind === 'project'
        ? await firstValueFrom(this.client.getProject(scope.projectKey, slot))
        : await firstValueFrom(this.client.getInstance(slot));
    return toDocument(scope, raw);
  }

  private apply(document: AgentPromptDocument): void {
    this.document.set(document);
    this.mode.set(document.mode);
    this.body.set(document.body ?? '');
  }

  private async loadPlaceholders(): Promise<void> {
    if (this.placeholders().length) return;
    try {
      this.placeholders.set(await firstValueFrom(this.client.placeholders()));
    } catch {
      this.placeholders.set([]);
    }
  }

  private schedulePreview(): void {
    this.cancelPreview();
    this.previewPending.set(true);
    this.previewTimer = setTimeout(() => void this.refreshPreview(), PREVIEW_DEBOUNCE_MS);
  }

  private cancelPreview(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
  }
}

/// Maps a project or instance prompt DTO to the editor's document.
export function toDocument(
  scope: AgentPromptScope,
  raw: ProjectAgentPrompt | InstanceAgentPrompt,
): AgentPromptDocument {
  if (scope.kind === 'project') {
    const prompt = raw as ProjectAgentPrompt;
    return {
      version: prompt.version,
      mode: prompt.mode,
      body: prompt.body,
      effectiveBody: prompt.effectiveBody,
      reference: { label: `Default v${prompt.defaultVersion}`, body: prompt.defaultBody },
      referenceChanged: prompt.defaultChanged,
      updatedBy: prompt.updatedBy,
      updatedAt: prompt.updatedAt,
      raw,
    };
  }
  const prompt = raw as InstanceAgentPrompt;
  return {
    version: prompt.version,
    mode: 'Custom',
    body: prompt.body,
    effectiveBody: prompt.body,
    reference: { label: `Built-in ${prompt.latestBuiltInVersion}`, body: prompt.builtInBody },
    referenceChanged: prompt.newerBuiltInAvailable,
    updatedBy: prompt.updatedBy,
    updatedAt: prompt.updatedAt,
    raw,
  };
}
