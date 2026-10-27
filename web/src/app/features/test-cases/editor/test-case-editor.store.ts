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
  TestCaseForm,
  toNew,
  toPatch,
  validate,
} from './test-case-form';

/// Editor state of one test case (create or edit). Saves send `If-Match` because the case holds long
/// text (D-43); a conflict reloads the case and tells the user. Saves are pushed to the list store.
@Injectable()
export class TestCaseEditorStore {
  private readonly api = inject(TestCasesApi);
  private readonly toast = inject(ToastService);
  private readonly list = inject(TestCasesStore, { optional: true });

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

  readonly isNew = computed(() => this.key() === null);
  readonly errors = computed<FormErrors>(() => ({
    ...validate(this.form()),
    ...this.serverErrors(),
  }));
  readonly dirty = computed(() => {
    const saved = this.saved();
    return saved
      ? Object.keys(toPatch(saved, this.form())).length > 0
      : this.form().title.trim() !== '' || this.form().steps.length > 0;
  });
  readonly canEdit = computed(() => this.isNew() || (this.saved()?.permissions.canEdit ?? false));

  async load(
    projectKey: string,
    key: string | null,
    ticket: LinkedTicket | null = null,
  ): Promise<void> {
    this.projectKey.set(projectKey);
    this.key.set(key);
    this.serverErrors.set({});
    this.showErrors.set(false);
    this.error.set(null);
    if (key === null) {
      this.saved.set(null);
      this.form.set(emptyForm(ticket?.key ?? null));
      this.linkedTicket.set(ticket);
      this.status.set('loaded');
      return;
    }
    this.status.set('loading');
    try {
      const testCase = await firstValueFrom(this.api.get(key));
      if (this.key() !== key) return;
      this.apply(testCase);
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
  }

  linkTicket(ticket: LinkedTicket | null): void {
    this.linkedTicket.set(ticket);
    this.update({ ticketKey: ticket?.key ?? null });
  }

  /// Returns the saved test case, or null when invalid or failed.
  async save(): Promise<TestCase | null> {
    this.showErrors.set(true);
    if (Object.keys(validate(this.form())).length > 0 || this.saving()) return null;
    const saved = this.saved();
    if (saved && !this.dirty()) return saved;
    this.saving.set(true);
    try {
      const result = saved
        ? await firstValueFrom(
            this.api.update(saved.key, toPatch(saved, this.form()), saved.rowVersion),
          )
        : await firstValueFrom(
            this.api.create(this.projectKey(), toNew(this.form()), crypto.randomUUID()),
          );
      this.apply(result);
      this.key.set(result.key);
      this.list?.saved(result);
      this.showErrors.set(false);
      return result;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'concurrency.conflict' && saved) {
        this.toast.warning(
          `${saved.key} was changed by someone else. Reloaded the latest version.`,
        );
        await this.load(this.projectKey(), saved.key);
      } else if (apiError.isValidation) {
        this.serverErrors.set(serverErrors(apiError));
        if (!Object.keys(this.serverErrors()).length) this.toast.error(apiError);
      } else {
        this.toast.error(apiError);
      }
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  revert(): void {
    const saved = this.saved();
    if (saved) this.apply(saved);
    this.serverErrors.set({});
    this.showErrors.set(false);
  }

  async setArchived(archived: boolean): Promise<void> {
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
    try {
      await firstValueFrom(this.api.delete(saved.key));
      this.list?.deleted(saved);
      this.toast.success(`${saved.key} deleted.`);
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
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
