import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '@core/notify/toast.service';
import { TestCasesApi } from '@core/testing/testing.api';
import { TestCaseSummary } from '@core/testing/testing.models';
import { TicketCache } from '@core/tickets/ticket-cache';
import { REGRESSION_ITEM_STATUS_LABELS } from '@shared/domain/enums';
import { TestCaseStatusBadgeComponent } from '@shared/ui/domain/domain-badges';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { RUN_STATUS_ICONS, TEST_CASE_ICONS } from '../test-case-icons';

/// "Test cases" section of the ticket view (registered through `provideTicketDetailSection`): the
/// ticket's test cases with status and last result, quick add by title, and a link to the full editor.
@Component({
  selector: 'tk-ticket-test-cases',
  imports: [MatTooltip, RouterLink, TestCaseStatusBadgeComponent, IconComponent],
  viewProviders: [provideIcons(TEST_CASE_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'sec', 'data-testid': 'ticket-test-cases' },
  template: `
    <div class="sec-h">
      <h2>Test cases</h2>
      @if (cases().length > 0) {
        <span class="n tnum">{{ cases().length }}</span>
      }
      @if (canEdit()) {
        <span class="right">
          <button type="button" class="add" data-testid="ticket-tc-add" (click)="startAdding()">
            <tk-icon name="tablerPlus" [size]="14" />New
          </button>
          <a class="add" data-testid="ticket-tc-editor" [routerLink]="['/projects', projectKey(), 'test-cases', 'new']" [queryParams]="{ forTicket: ticketKey() }">
            <tk-icon name="tablerListNumbers" [size]="14" />With steps
          </a>
        </span>
      }
    </div>
    <div class="box">
      @for (testCase of cases(); track testCase.id) {
        <a class="lrow" [routerLink]="['/projects', projectKey(), 'test-cases', testCase.key]" [attr.data-testid]="'ticket-tc-' + testCase.key">
          <span class="st"><tk-test-case-status-badge [status]="testCase.status" /></span>
          <span class="key tnum">{{ testCase.key }}</span>
          <span class="t">{{ testCase.title }}</span>
          @if (testCase.lastRun; as run) {
            <tk-icon
              [name]="runIcons[run.status].icon"
              [size]="16"
              [style.color]="runIcons[run.status].color"
              [matTooltip]="'Last result: ' + runLabels[run.status] + ' in ' + run.sessionKey"
            />
          }
        </a>
      }
      @if (adding()) {
        <div class="lrow new">
          <tk-icon name="tablerCircleDashed" [size]="14" />
          <input
            #title
            class="new-input"
            maxlength="200"
            placeholder="Test case title — Enter to create, Esc to cancel"
            aria-label="Test case title"
            data-testid="ticket-tc-input"
            [disabled]="saving()"
            (keydown.enter)="create(title.value); title.value = ''"
            (keydown.escape)="$event.stopPropagation(); adding.set(false)"
            (blur)="!title.value && adding.set(false)"
          />
        </div>
      }
      @if (loaded() && cases().length === 0 && !adding()) {
        <div class="empty">No test cases for this ticket.</div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-top: 28px;
    }
    .sec-h {
      height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .sec-h h2 {
      margin: 0;
      font-size: var(--tk-text-md);
      font-weight: var(--tk-weight-semibold);
    }
    .sec-h .n {
      color: var(--tk-text-subtle);
      font-weight: var(--tk-weight-medium);
    }
    .sec-h .right {
      margin-left: auto;
      display: flex;
      gap: 2px;
    }
    .add {
      height: 26px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      text-decoration: none;
      cursor: pointer;
    }
    .add:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    .box {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
      background: var(--tk-surface);
    }
    .lrow {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px 0 12px;
      border-bottom: 1px solid var(--tk-border-subtle);
      color: var(--tk-text);
      text-decoration: none;
    }
    .lrow:last-child {
      border-bottom: 0;
    }
    a.lrow:hover {
      background: var(--tk-bg-hover);
    }
    .st {
      width: 92px;
      flex: none;
    }
    .key {
      width: 76px;
      flex: none;
      color: var(--tk-text-muted);
    }
    .t {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .new {
      color: var(--tk-text-subtle);
    }
    .new-input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
    }
    .empty {
      padding: 9px 12px;
      color: var(--tk-text-subtle);
    }
  `,
})
export class TicketTestCasesComponent {
  private readonly api = inject(TestCasesApi);
  private readonly cache = inject(TicketCache);
  private readonly toast = inject(ToastService);

  readonly ticketKey = input.required<string>();
  readonly ticketId = input.required<string>();
  readonly projectKey = input.required<string>();

  protected readonly runIcons = RUN_STATUS_ICONS;
  protected readonly runLabels = REGRESSION_ITEM_STATUS_LABELS;
  protected readonly cases = signal<readonly TestCaseSummary[]>([]);
  protected readonly loaded = signal(false);
  protected readonly canEdit = signal(false);
  protected readonly adding = signal(false);
  protected readonly saving = signal(false);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('title');

  constructor() {
    effect(() => {
      const key = this.ticketKey();
      untracked(() => void this.load(key));
    });
  }

  protected startAdding(): void {
    this.adding.set(true);
    setTimeout(() => this.titleInput()?.nativeElement.focus());
  }

  protected async create(title: string): Promise<void> {
    const text = title.trim();
    if (!text || this.saving()) return;
    this.saving.set(true);
    try {
      const created = await firstValueFrom(this.api.create(this.projectKey(), { title: text, ticketKey: this.ticketKey() }, crypto.randomUUID()));
      this.cases.update((cases) => [
        ...cases,
        {
          id: created.id,
          key: created.key,
          number: created.number,
          title: created.title,
          status: created.status,
          stepCount: created.steps.length,
          ticket: created.ticket,
          archived: false,
          updatedAt: created.updatedAt,
          lastRun: null,
        },
      ]);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.saving.set(false);
      setTimeout(() => this.titleInput()?.nativeElement.focus());
    }
  }

  private async load(ticketKey: string): Promise<void> {
    this.loaded.set(false);
    const [cases, ticket] = await Promise.allSettled([firstValueFrom(this.api.forTicket(ticketKey)), this.cache.fetch(ticketKey)]);
    if (ticketKey !== this.ticketKey()) return;
    if (cases.status === 'fulfilled') this.cases.set(cases.value);
    this.canEdit.set(ticket.status === 'fulfilled' && ticket.value.permissions.canEdit);
    this.loaded.set(true);
  }
}
