import { defineView } from '@core/views/view-definition';

export const TEST_CASES_VIEW = defineView({
  viewId: 'testcases.list',
  variants: { default: () => import('./list/test-cases.view').then((m) => m.TestCasesView) },
});

export const TEST_CASE_EDITOR_VIEW = defineView({
  viewId: 'testcases.editor',
  variants: {
    default: () => import('./editor/test-case-editor.view').then((m) => m.TestCaseEditorView),
  },
});
