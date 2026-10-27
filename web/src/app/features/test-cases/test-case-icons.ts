import {
  tablerArchive,
  tablerArrowBackUp,
  tablerArrowDown,
  tablerArrowUp,
  tablerGripVertical,
  tablerLink,
  tablerListNumbers,
  tablerTrash,
} from '@ng-icons/tabler-icons';
import { RegressionItemStatus } from '@shared/domain/enums';

/// Icons used only by the test case feature, registered with `provideIcons` in `viewProviders`.
export const TEST_CASE_ICONS = {
  tablerArchive,
  tablerArrowBackUp,
  tablerArrowDown,
  tablerArrowUp,
  tablerGripVertical,
  tablerLink,
  tablerListNumbers,
  tablerTrash,
};

/// Glyph and colour of a regression result, as in the regression item badge (design-system §8).
export const RUN_STATUS_ICONS: Record<RegressionItemStatus, { icon: string; color: string }> = {
  WaitingForExecution: { icon: 'tablerCircle', color: 'var(--tk-run-waiting)' },
  Passed: { icon: 'tablerCircleCheck', color: 'var(--tk-run-passed)' },
  Failed: { icon: 'tablerCircleX', color: 'var(--tk-run-failed)' },
  Skipped: { icon: 'tablerCircleMinus', color: 'var(--tk-run-skipped)' },
};
