import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { TestCasesApi } from '@core/testing/testing.api';
import { LinkedTicket, TestCase } from '@core/testing/testing.models';
import { TestCasesStore } from '../list/test-cases.store';
import {
  emptyForm,
  formFrom,
  FormErrors,
  TestCaseDraft,
  TestCaseForm,
  toNew,
  toPatch,
  validate,
} from './test-case-form';

export const AUTOSAVE_DELAY_MS = 800;
export const NEW_DRAFT_KEY = 'new';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'failed';

/// Editor state of one test case (create or edit). An existing case autosaves: field changes are
/// debounced, blur and switching cases flush them, and saves are serialized so each sends the latest
/// `If-Match` (D-43). Edits that cannot be saved (invalid, failed) are kept as a draft in the list store
/// and restored when the case is opened again. A conflict reloads the case and tells the user.
@Injectable()
export class TestCaseEditorStore {
  private readonly api = inject(TestCasesApi);
  private readonly toast = inject(ToastService);
  private readonly list = inject(TestCasesStore, { optional: true });
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  readonly projectKey = signal('');
  readonly key = signal<string | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly saved = signal<TestCase | null>(null);
  readonly form = signal<TestCaseForm>(emptyForm());
  readonly linkedTicket = signal<LinkedTicket | null>(null);
  readonly saving = signal(false);
  readonly serverErrors = signal<FormErrors>({});
  readonly showErrors = signal(false);
  readonly saveFailed = signal(false);
  readonly lastSavedAt = signal<Date | null>(null);
  readonly restoredDraft = signal(false);

  readonly isNew = computed(() => this.key() === null);
  readonly errors = computed<FormErrors>(() => ({
    ...validate(this.form()),
    ...this.serverErrors(),
  }));
  readonly valid = computed(() => Object.keys(validate(this.form())).length === 0);
  readonly dirty = computed(() => {
    const saved = this.saved();
    return saved
      ? Object.keys(toPatch(saved, this.form())).length > 0
      : this.form().title.trim() !== '' || this.form().steps.length > 0;
  });
  readonly canEdit = computed(() => this.isNew() || (this.saved()?.permissions.canEdit ?? false));
  readonly autosave = computed<AutosaveState>(() => {
    if (this.isNew()) return 'idle';
    if (this.saving()) return 'saving';
    if (!this.dirty()) return this.lastSavedAt() ? 'saved' : 'idle';
    if (!this.valid() || Object.keys(this.serverErrors()).length) return 'invalid';
    return this.saveFailed() ? 'failed' : 'pending';
  });

  async load(
    projectKey: string,
    key: string | null,
    ticket: LinkedTicket | null = null,
  ): Promise<void> {
    this.cancelTimer();
    this.projectKey.set(projectKey);
    this.key.set(key);
    this.serverErrors.set({});
    this.showErrors.set(false);
    this.saveFailed.set(false);
    this.lastSavedAt.set(null);
    this.restoredDraft.set(false);
    this.error.set(null);
    if (key === null) {
      this.saved.set(null);
      const draft = this.list?.takeDraft(NEW_DRAFT_KEY);
      this.form.set(draft?.form ?? emptyForm(ticket?.key ?? null));
      this.linkedTicket.set(draft ? draft.linkedTicket : ticket);
      this.restoredDraft.set(!!draft);
      this.status.set('loaded');
      return;
    }
    this.status.set('loading');
    try {
      const testCase = await firstValueFrom(this.api.get(key));
      if (this.key() !== key) return;
      this.apply(testCase);
      const draft = this.list?.takeDraft(key);
      if (draft) {
        this.form.set(draft.form);
        this.linkedTicket.set(draft.linkedTicket);
        this.restoredDraft.set(true);
        this.showErrors.set(true);
      }
      this.status.set('loaded');
    } catch (error) {
      if (this.key() !== key) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  update(change: Partial<TestCaseForm>): void {
    this.form.update((form) => ({ ...form, ...change }));
    if (Object.keys(this.serverErrors()).length) this.serverErrors.set({});
    this.saveFailed.set(false);
    if (this.isNew()) return;
    this.showErrors.set(true);
    this.scheduleAutosave();
  }

  linkTicket(ticket: LinkedTicket | null): void {
    this.linkedTicket.set(ticket);
    this.update({ ticketKey: ticket?.key ?? null });
    void this.flush();
  }

  /// Saves pending changes of an existing case now. Resolves true when nothing is left unsaved.
  flush(): Promise<boolean> {
    this.cancelTimer();
    const run = this.queue.then(() => this.flushNow());
    this.queue = run.catch(() => undefined);
    return run;
  }

  /// Creates the new case, or saves the existing one now. Returns the saved case, or null when invalid
  /// or failed.
  async save(): Promise<TestCase | null> {
    if (!this.isNew()) {
      this.showErrors.set(true);
      return (await this.flush()) ? this.saved() : null;
    }
    this.showErrors.set(true);
    if (!this.valid() || this.saving()) return null;
    this.saving.set(true);
    try {
      const result = await firstValueFrom(
        this.api.create(this.projectKey(), toNew(this.form()), crypto.randomUUID()),
      );
      this.apply(result);
      this.key.set(result.key);
      this.list?.saved(result);
      this.showErrors.set(false);
      return result;
    } catch (error) {
      this.handleError(toApiError(error), null);
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /// Called when the editor goes away or switches to another case: saves what can be saved and keeps
  /// the rest as a draft. Returns the key whose edits were kept as a draft, if any.
  async leave(): Promise<string | null> {
    if (this.status() !== 'loaded' || !this.canEdit() || !this.dirty()) return null;
    if (this.isNew()) return this.keepDraft(NEW_DRAFT_KEY);
    const key = this.key()!;
    const draft = this.snapshot();
    if (await this.flush()) return null;
    return this.keepDraft(key, draft);
  }

  discard(): void {
    this.cancelTimer();
    const saved = this.saved();
    if (saved) this.apply(saved);
    else this.form.set(emptyForm());
    this.serverErrors.set({});
    this.showErrors.set(false);
    this.saveFailed.set(false);
    this.restoredDraft.set(false);
  }

  async setArchived(archived: boolean): Promise<void> {
    if (!(await this.flush())) return;
    const saved = this.saved();
    if (!saved) return;
    try {
      const result = await firstValueFrom(this.api.update(saved.key, { archived }));
      this.saved.set(result);
      this.list?.saved(result);
      this.toast.success(
        archived
          ? `${saved.key} archived. It is excluded from new regression sessions.`
          : `${saved.key} restored.`,
      );
    } catch (error) {
      this.toast.error(error);
    }
  }

  async delete(): Promise<boolean> {
    const saved = this.saved();
    if (!saved) return false;
    this.cancelTimer();
    try {
      await firstValueFrom(this.api.delete(saved.key));
      this.list?.deleted(saved);
      this.apply(saved);
      this.toast.success(`${saved.key} deleted.`);
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
  }

  private scheduleAutosave(): void {
    this.cancelTimer();
    this.timer = setTimeout(() => void this.flush(), AUTOSAVE_DELAY_MS);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async flushNow(): Promise<boolean> {
    const saved = this.saved();
    if (this.isNew() || !saved || !this.canEdit()) return !this.dirty();
    const patch = toPatch(saved, this.form());
    if (Object.keys(patch).length === 0) return true;
    if (!this.valid()) {
      this.showErrors.set(true);
      return false;
    }
    this.saving.set(true);
    try {
      const result = await firstValueFrom(this.api.update(saved.key, patch, saved.rowVersion));
      this.list?.saved(result);
      if (this.key() !== saved.key) return true;
      this.saved.set(result);
      if ((this.form().ticketKey ?? null) === (result.ticket?.key ?? null))
        this.linkedTicket.set(result.ticket);
      this.lastSavedAt.set(new Date());
      this.saveFailed.set(false);
      if (this.dirty()) this.scheduleAutosave();
      else this.restoredDraft.set(false);
      return !this.dirty();
    } catch (error) {
      if (this.key() === saved.key) this.handleError(toApiError(error), saved);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private handleError(apiError: ApiError, saved: TestCase | null): void {
    if (apiError.code === 'concurrency.conflict' && saved) {
      this.toast.warning(`${saved.key} was changed by someone else. Reloaded the latest version.`);
      void this.load(this.projectKey(), saved.key);
    } else if (apiError.isValidation) {
      this.serverErrors.set(serverErrors(apiError));
      this.showErrors.set(true);
      if (!Object.keys(this.serverErrors()).length) this.toast.error(apiError);
    } else {
      this.saveFailed.set(true);
      this.toast.error(apiError);
    }
  }

  private snapshot(): TestCaseDraft {
    return { form: this.form(), linkedTicket: this.linkedTicket() };
  }

  private keepDraft(key: string, draft: TestCaseDraft = this.snapshot()): string | null {
    if (!this.list) return null;
    this.list.keepDraft(key, draft);
    return key;
  }

  private apply(testCase: TestCase): void {
    this.saved.set(testCase);
    this.form.set(formFrom(testCase));
    this.linkedTicket.set(testCase.ticket);
  }
}

function serverErrors(error: ApiError): FormErrors {
  const result: FormErrors = {};
  for (const field of [
    'title',
    'steps',
    'preconditions',
    'expectedResult',
    'automationReference',
  ] as const) {
    const message = error.fieldError(field);
    if (message) result[field] = message;
  }
  return result;
}
