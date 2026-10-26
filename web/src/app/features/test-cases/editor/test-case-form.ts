import { NewTestCase, TestCase, TestCasePatch } from '@core/testing/testing.models';
import { TestCaseStatus } from '@shared/domain/enums';

export const TITLE_MAX = 200;
export const STEP_MAX = 1000;
export const MAX_STEPS = 50;
export const MARKDOWN_MAX = 4000;
export const AUTOMATION_MAX = 500;

/// Editable state of a test case. Steps carry a stable local id so the reorderable list keeps focus
/// and DOM identity while steps are typed, added, moved and removed.
export interface TestCaseForm {
  title: string;
  status: TestCaseStatus;
  preconditions: string;
  steps: readonly FormStep[];
  expectedResult: string;
  automationReference: string;
  ticketKey: string | null;
}

export interface FormStep {
  id: number;
  text: string;
}

export type FormErrors = Partial<Record<'title' | 'steps' | 'automationReference' | 'preconditions' | 'expectedResult', string>>;

let nextStepId = 1;

export function newStep(text = ''): FormStep {
  return { id: nextStepId++, text };
}

export function emptyForm(ticketKey: string | null = null): TestCaseForm {
  return { title: '', status: 'New', preconditions: '', steps: [], expectedResult: '', automationReference: '', ticketKey };
}

export function formFrom(testCase: TestCase): TestCaseForm {
  return {
    title: testCase.title,
    status: testCase.status,
    preconditions: testCase.preconditions ?? '',
    steps: testCase.steps.map((s) => newStep(s)),
    expectedResult: testCase.expectedResult ?? '',
    automationReference: testCase.automationReference ?? '',
    ticketKey: testCase.ticket?.key ?? null,
  };
}

/// Blank steps are dropped on save, like trailing empty rows in a list editor.
export function cleanSteps(form: TestCaseForm): string[] {
  return form.steps.map((s) => s.text.trim()).filter((s) => s.length > 0);
}

/// Client-side mirror of the server rules (spec 4.9), so the editor can point at the field before saving.
export function validate(form: TestCaseForm): FormErrors {
  const errors: FormErrors = {};
  const title = form.title.trim();
  if (!title) errors.title = 'Title is required.';
  else if (title.length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters.`;
  else if (/[\r\n]/.test(title)) errors.title = 'Title must be a single line.';

  const steps = cleanSteps(form);
  if (steps.length > MAX_STEPS) errors.steps = `At most ${MAX_STEPS} steps.`;
  else if (steps.some((s) => s.length > STEP_MAX)) errors.steps = `Each step can have at most ${STEP_MAX} characters.`;
  else if (form.status === 'Manual' && steps.length === 0) errors.steps = 'A Manual test case needs at least one step.';

  if (form.preconditions.trim().length > MARKDOWN_MAX) errors.preconditions = `At most ${MARKDOWN_MAX} characters.`;
  if (form.expectedResult.trim().length > MARKDOWN_MAX) errors.expectedResult = `At most ${MARKDOWN_MAX} characters.`;
  if (form.automationReference.trim().length > AUTOMATION_MAX) errors.automationReference = `At most ${AUTOMATION_MAX} characters.`;
  return errors;
}

export function toNew(form: TestCaseForm): NewTestCase {
  return {
    title: form.title.trim(),
    status: form.status,
    preconditions: orNull(form.preconditions),
    steps: cleanSteps(form),
    expectedResult: orNull(form.expectedResult),
    automationReference: orNull(form.automationReference),
    ticketKey: form.ticketKey,
  };
}

/// Only the fields that differ from the saved test case; an empty object means nothing to save.
export function toPatch(saved: TestCase, form: TestCaseForm): TestCasePatch {
  const patch: TestCasePatch = {};
  const title = form.title.trim();
  if (title !== saved.title) patch.title = title;
  if (form.status !== saved.status) patch.status = form.status;
  if (orNull(form.preconditions) !== saved.preconditions) patch.preconditions = orNull(form.preconditions);
  if (orNull(form.expectedResult) !== saved.expectedResult) patch.expectedResult = orNull(form.expectedResult);
  if (orNull(form.automationReference) !== saved.automationReference) patch.automationReference = orNull(form.automationReference);
  const steps = cleanSteps(form);
  if (steps.length !== saved.steps.length || steps.some((s, i) => s !== saved.steps[i])) patch.steps = steps;
  if ((form.ticketKey ?? null) !== (saved.ticket?.key ?? null)) patch.ticketKey = form.ticketKey;
  return patch;
}

export function moveStep(steps: readonly FormStep[], from: number, to: number): FormStep[] {
  const result = [...steps];
  if (from < 0 || from >= result.length || to < 0 || to >= result.length) return result;
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
