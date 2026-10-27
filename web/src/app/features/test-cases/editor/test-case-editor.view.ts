import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { firstValueFrom } from 'rxjs';
import { PeekService } from '@core/layout/peek/peek';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
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
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { RUN_STATUS_ICONS, TEST_CASE_ICONS } from '../test-case-icons';
import { AUTOMATION_MAX, MARKDOWN_MAX, TITLE_MAX } from './test-case-form';
import { StepsEditorComponent } from './steps-editor.component';
import { NEW_DRAFT_KEY, TestCaseEditorStore } from './test-case-editor.store';

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
  private readonly toast = inject(ToastService);

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
    (await firstValueFrom(this.tickets.find(this.projectKey(), query))).map((t) => ({
      value: t,
      label: `${t.key} ${t.title}`,
    }));

  constructor() {
    effect(() => {
      const projectKey = this.projectKey();
      const key = this.testCaseKey()?.toUpperCase() ?? null;
      const forTicket = key ? null : (this.forTicket()?.toUpperCase() ?? null);
      untracked(() => void this.open(projectKey, key, forTicket));
    });

    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => void this.leave());

    inject(ShortcutService).registerScoped(
      [
        {
          keys: 'mod+enter',
          description: 'Save the test case',
          section: 'Test cases',
          allowInInputs: true,
          handler: (e) => this.save(e),
        },
        {
          keys: 'escape',
          description: 'Close the editor',
          section: 'Test cases',
          handler: () => this.close(),
        },
      ],
      destroyRef,
    );
  }

  protected readonly saveState = computed(() => {
    switch (this.store.autosave()) {
      case 'saving':
        return { label: 'Saving…', icon: 'tablerLoader2', tone: 'muted' };
      case 'saved':
        return { label: 'Saved', icon: 'tablerCheck', tone: 'success' };
      case 'pending':
        return { label: 'Unsaved changes', icon: 'tablerPoint', tone: 'muted' };
      case 'invalid':
        return { label: 'Not saved: fix the errors', icon: 'tablerAlertCircle', tone: 'danger' };
      case 'failed':
        return { label: 'Couldn’t save', icon: 'tablerAlertCircle', tone: 'danger' };
      default:
        return null;
    }
  });

  protected setStatus(status: TestCaseStatus): void {
    this.store.update({ status });
  }

  protected pickTicket(ticket: TicketRef): void {
    this.store.linkTicket({
      id: ticket.id,
      key: ticket.key,
      title: ticket.title,
      type: ticket.type,
      status: ticket.status,
    });
  }

  protected openTicket(key: string): void {
    this.peek.open(key);
  }

  protected async save(event?: Event): Promise<void> {
    event?.preventDefault();
    const wasNew = this.store.isNew();
    const saved = await this.store.save();
    if (saved && wasNew) {
      void this.router.navigate(['..', saved.key], {
        relativeTo: this.route,
        queryParamsHandling: 'merge',
        queryParams: { forTicket: null },
      });
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

  protected flush(): void {
    void this.store.flush();
  }

  protected async close(): Promise<void> {
    if (this.store.canEdit() && !(await this.store.flush()) && this.store.dirty()) {
      const discard = await this.confirm.confirm({
        title: 'Discard changes?',
        message: this.store.isNew()
          ? 'This new test case hasn’t been created yet.'
          : 'Some changes to this test case couldn’t be saved and will be lost.',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!discard) return;
      this.store.discard();
    }
    void this.router.navigate(['..'], {
      relativeTo: this.route,
      queryParamsHandling: 'merge',
      queryParams: { forTicket: null },
    });
  }

  private async open(
    projectKey: string,
    key: string | null,
    forTicket: string | null,
  ): Promise<void> {
    await this.leave();
    let ticket: LinkedTicket | null = null;
    if (forTicket) {
      const match = (await firstValueFrom(this.tickets.find(projectKey, forTicket))).find(
        (t) => t.key === forTicket,
      );
      if (match)
        ticket = {
          id: match.id,
          key: match.key,
          title: match.title,
          type: match.type,
          status: match.status,
        };
    }
    await this.store.load(projectKey, key, ticket);
  }

  private async leave(): Promise<void> {
    const projectKey = this.store.projectKey();
    const kept = await this.store.leave();
    if (!kept) return;
    const isNew = kept === NEW_DRAFT_KEY;
    this.toast.warning(
      isNew
        ? 'Kept the new test case as a draft. It isn’t created yet.'
        : `Kept your unsaved changes to ${kept} as a draft.`,
      {
        action: {
          label: 'Open',
          run: () =>
            void this.router.navigate(['/projects', projectKey, 'test-cases', kept], {
              queryParamsHandling: 'preserve',
            }),
        },
      },
    );
  }
}
