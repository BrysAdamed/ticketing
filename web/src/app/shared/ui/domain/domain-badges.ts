import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  REGRESSION_ITEM_STATUS_LABELS,
  REGRESSION_SESSION_STATUS_LABELS,
  RegressionItemStatus,
  RegressionSessionStatus,
  SEVERITY_LABELS,
  Severity,
  TEST_CASE_STATUS_LABELS,
  TestCaseStatus,
} from '@shared/domain/enums';
import { BadgeComponent, BadgeTone } from './badge.component';

const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  Blocker: 'solid-danger',
  Critical: 'solid-danger',
  Major: 'red',
  Minor: 'amber',
  Trivial: 'gray',
};

/// Severity badge. Blocker adds a ban glyph so it reads differently from Critical.
@Component({
  selector: 'tk-severity-badge',
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<tk-badge [tone]="tone()" [icon]="severity() === 'Blocker' ? 'tablerBan' : null">{{
    label()
  }}</tk-badge>`,
})
export class SeverityBadgeComponent {
  readonly severity = input.required<Severity>();
  protected readonly tone = computed(() => SEVERITY_TONES[this.severity()]);
  protected readonly label = computed(() => SEVERITY_LABELS[this.severity()]);
}

const TEST_CASE: Record<TestCaseStatus, { tone: BadgeTone; icon: string }> = {
  New: { tone: 'blue', icon: 'tablerCircleDashed' },
  Manual: { tone: 'violet', icon: 'tablerHandStop' },
  Automatic: { tone: 'teal', icon: 'tablerRobot' },
};

@Component({
  selector: 'tk-test-case-status-badge',
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<tk-badge [tone]="style().tone" [icon]="style().icon">{{ label() }}</tk-badge>`,
})
export class TestCaseStatusBadgeComponent {
  readonly status = input.required<TestCaseStatus>();
  protected readonly style = computed(() => TEST_CASE[this.status()]);
  protected readonly label = computed(() => TEST_CASE_STATUS_LABELS[this.status()]);
}

const REGRESSION_ITEM: Record<RegressionItemStatus, { tone: BadgeTone; icon: string }> = {
  WaitingForExecution: { tone: 'gray', icon: 'tablerCircle' },
  Passed: { tone: 'green', icon: 'tablerCircleCheck' },
  Failed: { tone: 'red', icon: 'tablerCircleX' },
  Skipped: { tone: 'muted', icon: 'tablerCircleMinus' },
};

/// Regression item status. `autoPassed` labels an automatic case that started as Passed (D-13).
@Component({
  selector: 'tk-regression-item-badge',
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<tk-badge [tone]="style().tone" [icon]="autoPassed() ? 'tablerRobot' : style().icon">{{
    label()
  }}</tk-badge>`,
})
export class RegressionItemBadgeComponent {
  readonly status = input.required<RegressionItemStatus>();
  readonly autoPassed = input(false);
  protected readonly style = computed(() => REGRESSION_ITEM[this.status()]);
  protected readonly label = computed(() =>
    this.autoPassed() && this.status() === 'Passed'
      ? 'Auto-passed'
      : REGRESSION_ITEM_STATUS_LABELS[this.status()],
  );
}

const SESSION_TONES: Record<RegressionSessionStatus, BadgeTone> = {
  InProgress: 'blue',
  Completed: 'green',
  Cancelled: 'gray',
};

@Component({
  selector: 'tk-regression-session-badge',
  imports: [BadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<tk-badge [tone]="tone()" [dot]="true">{{ label() }}</tk-badge>`,
})
export class RegressionSessionBadgeComponent {
  readonly status = input.required<RegressionSessionStatus>();
  protected readonly tone = computed(() => SESSION_TONES[this.status()]);
  protected readonly label = computed(() => REGRESSION_SESSION_STATUS_LABELS[this.status()]);
}
