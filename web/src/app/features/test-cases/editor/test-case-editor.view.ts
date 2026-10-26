import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { firstValueFrom } from 'rxjs';
import { PeekService } from '@core/layout/peek/peek';
import { ConfirmService } from '@core/notify/confirm.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { LinkedTicket } from '@core/testing/testing.models';
import { TicketRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { REGRESSION_ITEM_STATUS_LABELS, TestCaseStatus } from '@shared/domain/enums';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import { SegmentedControlComponent, SegmentOption } from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { RUN_STATUS_ICONS, TEST_CASE_ICONS } from '../test-case-icons';
import { AUTOMATION_MAX, MARKDOWN_MAX, TITLE_MAX } from './test-case-form';
import { StepsEditorComponent } from './steps-editor.component';
import { TestCaseEditorStore } from './test-case-editor.store';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// Test case editor in the test case list's side pane (`:testCaseKey` or `new?forTicket=KEY`): title,
/// status, automation reference, linked ticket, preconditions, reorderable steps, expected result and
/// the case's recent regression runs.
@Component({
  selector: 'tk-test-case-editor-view',
  imports: [
    MatButtonModule,
    MatMenuModule,
    MatTooltip,
    RouterLink,
    MarkdownEditorComponent,
    MarkdownViewerComponent,
    AbsoluteTimePipe,
    RelativeTimePipe,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    KbdComponent,
    SearchPickerDirective,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    StepsEditorComponent,
  ],
  providers: [TestCaseEditorStore],
  viewProviders: [provideIcons(TEST_CASE_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'editor', 'data-testid': 'view-testcases.editor' },
  templateUrl: './test-case-editor.view.html',
  styleUrl: './test-case-editor.view.scss',
})
export class TestCaseEditorView {
  protected readonly store = inject(TestCaseEditorStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tickets = inject(TicketsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly peek = inject(PeekService);

  readonly projectKey = input.required<string>();
  readonly testCaseKey = input<string | null>(null);
  readonly forTicket = input<string | null>(null);

  protected readonly titleMax = TITLE_MAX;
  protected readonly markdownMax = MARKDOWN_MAX;
  protected readonly automationMax = AUTOMATION_MAX;
  protected readonly runIcons = RUN_STATUS_ICONS;
  protected readonly runLabels = REGRESSION_ITEM_STATUS_LABELS;
  protected readonly saveKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly statusOptions: SegmentOption<TestCaseStatus>[] = [
    { value: 'New', label: 'New', icon: 'tablerCircleDashed' },
    { value: 'Manual', label: 'Manual', icon: 'tablerHandStop' },
    { value: 'Automatic', label: 'Automatic', icon: 'tablerRobot' },
  ];
  protected readonly errors = computed(() => (this.store.showErrors() ? this.store.errors() : {}));
  protected readonly testCase = computed(() => this.store.saved());

  protected readonly ticketSearch = async (query: string): Promise<PickerOption<TicketRef>[]> =>
    (await firstValueFrom(this.tickets.find(this.projectKey(), query))).map((t) => ({ value: t, label: `${t.key} ${t.title}` }));

  constructor() {
    effect(() => {
      const projectKey = this.projectKey();
      const key = this.testCaseKey()?.toUpperCase() ?? null;
      const forTicket = key ? null : (this.forTicket()?.toUpperCase() ?? null);
      untracked(() => void this.open(projectKey, key, forTicket));
    });

    inject(ShortcutService).registerScoped(
      [
        { keys: 'mod+enter', description: 'Save the test case', section: 'Test cases', allowInInputs: true, handler: (e) => this.save(e) },
        { keys: 'escape', description: 'Close the editor', section: 'Test cases', handler: () => this.close() },
      ],
      inject(DestroyRef),
    );
  }

  protected setStatus(status: TestCaseStatus): void {
    this.store.update({ status });
  }

  protected pickTicket(ticket: TicketRef): void {
    this.store.linkTicket({ id: ticket.id, key: ticket.key, title: ticket.title, type: ticket.type, status: ticket.status });
  }

  protected openTicket(key: string): void {
    this.peek.open(key);
  }

  protected async save(event?: Event): Promise<void> {
    event?.preventDefault();
    const wasNew = this.store.isNew();
    const saved = await this.store.save();
    if (saved && wasNew) {
      void this.router.navigate(['..', saved.key], { relativeTo: this.route, queryParamsHandling: 'merge', queryParams: { forTicket: null } });
    }
  }

  protected async toggleArchive(): Promise<void> {
    const saved = this.store.saved();
    if (saved) await this.store.setArchived(saved.archivedAt === null);
  }

  protected async delete(): Promise<void> {
    const saved = this.store.saved();
    if (!saved) return;
    const ok = await this.confirm.confirm({
      title: `Delete ${saved.key}?`,
      message: 'The test case is removed permanently. It was never used in a regression session.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await this.store.delete())) this.close();
  }

  protected async close(): Promise<void> {
    if (this.store.dirty() && this.store.canEdit()) {
      const discard = await this.confirm.confirm({
        title: 'Discard changes?',
        message: 'Your unsaved changes to this test case will be lost.',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!discard) return;
    }
    void this.router.navigate(['..'], { relativeTo: this.route, queryParamsHandling: 'merge', queryParams: { forTicket: null } });
  }

  private async open(projectKey: string, key: string | null, forTicket: string | null): Promise<void> {
    let ticket: LinkedTicket | null = null;
    if (forTicket) {
      const match = (await firstValueFrom(this.tickets.find(projectKey, forTicket))).find((t) => t.key === forTicket);
      if (match) ticket = { id: match.id, key: match.key, title: match.title, type: match.type, status: match.status };
    }
    await this.store.load(projectKey, key, ticket);
  }
}
