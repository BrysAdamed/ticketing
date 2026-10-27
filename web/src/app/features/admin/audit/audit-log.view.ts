import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { AGENT_FLAG } from '@core/agent/agent-prompt.models';
import { FeatureFlagService } from '@core/flags/feature-flag.service';
import {
  ACTIVITY_ENTITY_TYPE_LABELS,
  WRITE_CHANNEL_LABELS,
  WriteChannel,
} from '@shared/domain/enums';
import { absoluteTime } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AuditEntry, UserLookup } from '../admin.models';
import { UserSearchComponent } from '../shared/user-search.component';
import { AuditDescription, describeAuditEntry } from './audit-format';
import { AuditLogStore, EntityFilter } from './audit-log.store';

interface AuditRow {
  entry: AuditEntry;
  description: AuditDescription;
  time: string;
  title: string;
}

interface AuditDay {
  label: string;
  rows: AuditRow[];
}

const ENTITY_ICONS: Record<string, string> = {
  User: 'tablerUser',
  PersonalAccessToken: 'tablerKey',
  FeatureFlag: 'tablerFlag',
  Project: 'tablerFolders',
  AgentPrompt: 'tablerRobot',
};

const timeFormat = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const TEXT_DEBOUNCE_MS = 300;

@Component({
  selector: 'tk-audit-log-view',
  imports: [
    MatButtonModule,
    MatTooltip,
    IconComponent,
    BadgeComponent,
    UserDisplayComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    UserSearchComponent,
  ],
  providers: [AuditLogStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.audit' },
  templateUrl: './audit-log.view.html',
  styleUrl: './audit-log.view.scss',
})
export class AuditLogView {
  protected readonly store = inject(AuditLogStore);
  protected readonly typeLabels = ACTIVITY_ENTITY_TYPE_LABELS;
  protected readonly entityIcons = ENTITY_ICONS;
  protected readonly typeOptions: SegmentOption<EntityFilter>[] = [
    { value: 'all', label: 'All' },
    { value: 'User', label: 'Users' },
    { value: 'PersonalAccessToken', label: 'Tokens' },
    { value: 'FeatureFlag', label: 'Flags' },
    { value: 'Project', label: 'Projects' },
    ...(inject(FeatureFlagService).isOn(AGENT_FLAG)
      ? [{ value: 'AgentPrompt' as const, label: 'Agent prompts' }]
      : []),
  ];

  protected readonly days = computed<AuditDay[]>(() => {
    const days: AuditDay[] = [];
    for (const entry of this.store.entries()) {
      const date = new Date(entry.occurredAt);
      const label = dayLabel(date);
      const row: AuditRow = {
        entry,
        description: describeAuditEntry(entry),
        time: timeFormat.format(date),
        title: absoluteTime(date),
      };
      const last = days.at(-1);
      if (last?.label === label) last.rows.push(row);
      else days.push({ label, rows: [row] });
    }
    return days;
  });

  private actionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.store.load();
    inject(DestroyRef).onDestroy(() => clearTimeout(this.actionTimer));
  }

  protected channelLabel(channel: WriteChannel | null): string | null {
    return channel ? WRITE_CHANNEL_LABELS[channel] : null;
  }

  protected setType(value: EntityFilter): void {
    this.store.entityType.set(value);
    void this.store.load();
  }

  protected setActor(user: UserLookup | null): void {
    this.store.actor.set(user);
    void this.store.load();
  }

  protected setAction(value: string): void {
    this.store.action.set(value);
    clearTimeout(this.actionTimer);
    this.actionTimer = setTimeout(() => void this.store.load(), TEXT_DEBOUNCE_MS);
  }

  protected setRange(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.store.from : this.store.to).set(value);
    void this.store.load();
  }
}

function dayLabel(date: Date, now = new Date()): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  if (time >= startOfToday) return 'Today';
  if (time >= startOfToday - 24 * 60 * 60 * 1000) return 'Yesterday';
  return dayFormat.format(date);
}
