import { defineView } from '@core/views/view-definition';

export const TEST_CASES_VIEW = defineView({
  viewId: 'testcases.list',
  variants: { default: () => import('./test-cases.view').then((m) => m.TestCasesView) },
});
