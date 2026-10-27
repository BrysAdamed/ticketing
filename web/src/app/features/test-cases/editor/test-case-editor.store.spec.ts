import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject } from 'rxjs';
import { ToastService } from '@core/notify/toast.service';
import { TestCasesApi } from '@core/testing/testing.api';
import { TestCase, TestCasePatch } from '@core/testing/testing.models';
import { TestCasesStore } from '../list/test-cases.store';
import { AUTOSAVE_DELAY_MS, NEW_DRAFT_KEY, TestCaseEditorStore } from './test-case-editor.store';
import { newStep } from './test-case-form';

function testCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'tc1',
    key: 'WEB-TC-1',
    projectKey: 'WEB',
    title: 'Log in',
    preconditions: null,
    steps: ['Open the page'],
    expectedResult: null,
    status: 'Manual',
    automationReference: null,
    ticket: null,
    archivedAt: null,
    updatedAt: '2026-10-01T00:00:00Z',
    permissions: { canEdit: true, canDelete: true },
    recentRuns: [],
    number: 1,
    rowVersion: 1,
    ...overrides,
  } as TestCase;
}

class FakeApi {
  cases = new Map<string, TestCase>([
    ['WEB-TC-1', testCase()],
    ['WEB-TC-2', testCase({ id: 'tc2', key: 'WEB-TC-2', title: 'Log out' })],
  ]);
  get = (key: string) => of(this.cases.get(key)!);
  update = vi.fn((key: string, patch: TestCasePatch, rowVersion?: number) =>
    this.respond(key, patch, rowVersion),
  );
  respond: (key: string, patch: TestCasePatch, rowVersion?: number) => Observable<TestCase> = (
    key,
    patch,
  ) => {
    const before = this.cases.get(key)!;
    const after = testCase({
      ...before,
      ...(patch as Partial<TestCase>),
      rowVersion: before.rowVersion + 1,
    });
    this.cases.set(key, after);
    return of(after);
  };
}

describe('TestCaseEditorStore autosave', () => {
  let api: FakeApi;
  let toast: { error: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> };
  let store: TestCaseEditorStore;
  let list: TestCasesStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    api = new FakeApi();
    toast = { error: vi.fn(), warning: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        TestCasesStore,
        TestCaseEditorStore,
        { provide: TestCasesApi, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    list = TestBed.inject(TestCasesStore);
    store = TestBed.inject(TestCaseEditorStore);
    await store.load('WEB', 'WEB-TC-1');
  });

  afterEach(() => vi.useRealTimers());

  it('saves a change after the debounce with If-Match and keeps the form being typed in', async () => {
    // Arrange
    const steps = store.form().steps;

    // Act
    store.update({ title: 'Log in with SSO ' });
    const beforeDelay = { calls: api.update.mock.calls.length, state: store.autosave() };
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    // Assert
    expect(beforeDelay).toEqual({ calls: 0, state: 'pending' });
    expect(api.update).toHaveBeenCalledExactlyOnceWith('WEB-TC-1', { title: 'Log in with SSO' }, 1);
    expect(store.form().title).toBe('Log in with SSO ');
    expect(store.form().steps).toBe(steps);
    expect([store.dirty(), store.autosave(), store.saved()?.rowVersion]).toEqual([
      false,
      'saved',
      2,
    ]);
  });

  it('saves edits made while a save is in flight with the next row version', async () => {
    // Arrange
    const first = new Subject<TestCase>();
    const respond = api.respond;
    api.respond = (key, patch, rowVersion) =>
      api.update.mock.calls.length === 1 ? first : respond(key, patch, rowVersion);

    // Act
    store.update({ title: 'First' });
    const flushing = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    store.update({ steps: [...store.form().steps, newStep('Second step')] });
    api.cases.set('WEB-TC-1', testCase({ title: 'First', rowVersion: 2 }));
    first.next(api.cases.get('WEB-TC-1')!);
    first.complete();
    await flushing;
    await store.flush();

    // Assert
    expect(api.update.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [{ title: 'First' }, 1],
      [{ steps: ['Open the page', 'Second step'] }, 2],
    ]);
    expect(store.dirty()).toBe(false);
  });

  it('does not save invalid edits and keeps them as a draft when leaving', async () => {
    // Arrange
    store.update({ title: '   ', expectedResult: 'Signed in' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);

    // Act
    const kept = await store.leave();
    await store.load('WEB', 'WEB-TC-2');
    const otherTitle = store.form().title;
    await store.load('WEB', 'WEB-TC-1');

    // Assert
    expect(api.update).not.toHaveBeenCalled();
    expect(kept).toBe('WEB-TC-1');
    expect(otherTitle).toBe('Log out');
    expect([store.form().expectedResult, store.restoredDraft(), store.autosave()]).toEqual([
      'Signed in',
      true,
      'invalid',
    ]);
  });

  it('saves pending edits right away when switching to another case', async () => {
    // Arrange
    store.update({ expectedResult: 'Signed in' });

    // Act
    const kept = await store.leave();
    await store.load('WEB', 'WEB-TC-2');

    // Assert
    expect(kept).toBeNull();
    expect(api.update).toHaveBeenCalledExactlyOnceWith(
      'WEB-TC-1',
      { expectedResult: 'Signed in' },
      1,
    );
    expect(api.cases.get('WEB-TC-1')?.expectedResult).toBe('Signed in');
    expect(store.form().title).toBe('Log out');
  });

  it('never autosaves a new case and keeps its unsaved content as the new draft', async () => {
    // Arrange
    await store.load('WEB', null);
    store.update({ title: 'Export the report' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);

    // Act
    const kept = await store.leave();
    await store.load('WEB', null);

    // Assert
    expect(api.update).not.toHaveBeenCalled();
    expect(kept).toBe(NEW_DRAFT_KEY);
    expect([store.form().title, store.restoredDraft()]).toEqual(['Export the report', true]);
    expect(list.takeDraft(NEW_DRAFT_KEY)).toBeNull();
  });
});
