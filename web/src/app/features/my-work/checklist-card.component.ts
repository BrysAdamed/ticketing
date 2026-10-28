import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerEye, tablerRoute } from '@ng-icons/tabler-icons';
import { HelpMenuRegistry } from '@core/help/help-menu.registry';
import { canWriteSomewhere, ChecklistEntry } from '@core/onboarding/checklist/checklist.model';
import { GettingStartedService } from '@core/onboarding/checklist/getting-started.service';
import { ProjectDirectory } from '@core/projects/project-directory';
import { TicketCreator } from '@core/tickets/create-ticket';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

const FIRST_PROJECT_HELP_ID = 'help.tour.first-project';

/// The getting-started checklist card on My work (spec 14.3, D-133): progress over the required
/// items, each item linking to where its action is done, the optional agent items in their own
/// group, Dismiss, and a completed state. Refreshes when shown and on window focus, so actions
/// done elsewhere (another tab, REST, MCP) tick items off.
@Component({
  selector: 'tk-checklist-card',
  imports: [
    NgTemplateOutlet,
    MatButtonModule,
    RouterLink,
    BadgeComponent,
    IconComponent,
    StatusIconComponent,
  ],
  viewProviders: [provideIcons({ tablerEye, tablerRoute })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:focus)': 'onWindowFocus()' },
  template: `
    @if (checklist.visible()) {
      <section
        class="ck"
        aria-labelledby="checklist-title"
        data-testid="checklist-card"
        [attr.data-complete]="checklist.completed()"
      >
        <div class="ck-head">
          <h2 class="t" id="checklist-title" tabindex="-1" #title>Getting started</h2>
          <span class="n tnum" data-testid="checklist-progress"
            >{{ progress().done }} of {{ progress().total }}</span
          >
          <span class="end">
            @if (checklist.completed()) {
              <button
                type="button"
                class="tk-icon-btn"
                aria-label="Close checklist"
                data-testid="checklist-hide"
                (click)="checklist.hide()"
              >
                <tk-icon name="tablerX" [size]="16" />
              </button>
            } @else {
              <button
                type="button"
                class="tk-icon-btn"
                aria-label="Dismiss checklist"
                data-testid="checklist-dismiss"
                (click)="checklist.dismiss()"
              >
                <tk-icon name="tablerX" [size]="16" />
              </button>
            }
          </span>
        </div>
        <div
          class="ck-bar"
          role="progressbar"
          aria-label="Getting started progress"
          [attr.aria-valuenow]="progress().done"
          aria-valuemin="0"
          [attr.aria-valuemax]="progress().total"
        >
          <i [style.width.%]="percent()"></i>
        </div>

        @if (checklist.completed()) {
          <div class="ck-done" data-testid="checklist-completed">
            <div class="big"><tk-icon name="tablerCheck" [size]="20" /></div>
            <h3>You're all set</h3>
            <p>
              Every first step is done. This card won't show on My work again; Help → Getting
              started brings it back.
            </p>
            <button mat-stroked-button type="button" (click)="checklist.hide()">Hide</button>
          </div>
        } @else {
          @for (group of checklist.groups(); track group.id) {
            @if (group.label) {
              <div class="ck-group">
                {{ group.label }}
                @if (group.optional) {
                  <tk-badge tone="muted">Optional</tk-badge>
                }
              </div>
            }
            <ul class="ck-items">
              @for (entry of group.entries; track entry.id) {
                <li>
                  @if (entry.done) {
                    <span
                      class="ck-item done"
                      [attr.data-testid]="'checklist-item-' + entry.id"
                      data-done="true"
                    >
                      <tk-status-icon class="mark" status="Done" [size]="16" />
                      <span class="lbl-t">{{ entry.copy.label }}</span>
                      <span class="tk-sr-only">, done</span>
                    </span>
                  } @else if (entry.id === 'create-ticket') {
                    <button
                      type="button"
                      class="ck-item"
                      [class.next]="checklist.next() === entry.id"
                      [attr.data-testid]="'checklist-item-' + entry.id"
                      data-done="false"
                      (click)="createTicket()"
                    >
                      <ng-container
                        *ngTemplateOutlet="open; context: { $implicit: entry }"
                      ></ng-container>
                    </button>
                  } @else {
                    <a
                      class="ck-item"
                      [class.next]="checklist.next() === entry.id"
                      [routerLink]="link(entry)"
                      [attr.data-testid]="'checklist-item-' + entry.id"
                      data-done="false"
                    >
                      <ng-container
                        *ngTemplateOutlet="open; context: { $implicit: entry }"
                      ></ng-container>
                    </a>
                  }
                </li>
              }
            </ul>
          }
          @if (!canWrite()) {
            <p class="ck-note" data-testid="checklist-read-only">
              <tk-icon name="tablerEye" [size]="14" />
              <span
                >You can't change any project yet, so steps that create, move or comment are
                hidden.</span
              >
            </p>
          }
          @if (firstProject(); as walkthrough) {
            <div class="ck-foot">
              <tk-icon name="tablerRoute" [size]="14" />New here?
              <button type="button" class="link end" (click)="walkthrough.run()">
                Your first project
              </button>
            </div>
          }
        }
      </section>
    } @else if (checklist.loading()) {
      <div class="ck skeleton" role="status" aria-label="Loading" data-testid="checklist-skeleton">
        <span class="bone head"></span>
        <span class="bone bar"></span>
        @for (row of skeletonRows; track $index) {
          <span class="bone row" [style.width.%]="row"></span>
        }
      </div>
    }

    <ng-template #open let-entry>
      <tk-status-icon class="mark" status="ToDo" [size]="16" />
      <span class="lbl-t">{{ entry.copy.label }}</span>
      <span class="go">
        @if (checklist.next() === entry.id) {
          {{ entry.copy.hint }}
        }
        <tk-icon name="tablerArrowRight" [size]="12" />
      </span>
    </ng-template>
  `,
  styleUrl: './checklist-card.component.scss',
})
export class ChecklistCardComponent {
  protected readonly checklist = inject(GettingStartedService);
  private readonly directory = inject(ProjectDirectory);
  private readonly creator = inject(TicketCreator);
  private readonly help = inject(HelpMenuRegistry);
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');

  protected readonly skeletonRows = [70, 55, 62, 48, 58];
  protected readonly progress = this.checklist.progress;
  protected readonly percent = computed(() => {
    const { done, total } = this.progress();
    return total === 0 ? 0 : Math.round((done / total) * 100);
  });
  protected readonly canWrite = computed(() => canWriteSomewhere(this.checklist.items()));
  protected readonly firstProject = computed(
    () => this.help.items().find((item) => item.id === FIRST_PROJECT_HELP_ID) ?? null,
  );

  private readonly writable = computed(
    () => this.directory.activeProjects().find((p) => p.myRole && p.myRole !== 'Viewer') ?? null,
  );
  private readonly owned = computed(
    () => this.directory.activeProjects().find((p) => p.myRole === 'Owner') ?? null,
  );
  private readonly anyProject = computed(() => this.directory.activeProjects()[0] ?? null);

  constructor() {
    void this.directory.load();
    if (untracked(this.checklist.loaded)) void this.checklist.refresh();

    effect(() => {
      if (this.checklist.visible() && this.progress().complete)
        untracked(() => this.checklist.acknowledgeCompletion());
    });

    afterRenderEffect(() => {
      const title = this.title()?.nativeElement;
      if (!this.checklist.focusRequested() || !title) return;
      untracked(() => this.checklist.focusHandled());
      title.scrollIntoView({ block: 'nearest' });
      title.focus({ preventScroll: true });
    });
  }

  protected onWindowFocus(): void {
    if (this.checklist.visible()) void this.checklist.refresh();
  }

  protected createTicket(): void {
    void this.creator.open();
  }

  protected link(entry: ChecklistEntry): string[] {
    const backlog = (key: string | undefined) =>
      key ? ['/projects', key, 'backlog'] : ['/projects'];
    const owned = this.owned()?.key;
    switch (entry.id) {
      case 'move-work':
      case 'join-conversation':
        return backlog(this.writable()?.key);
      case 'follow-ticket':
        return backlog(this.anyProject()?.key);
      case 'invite-team':
        return owned ? ['/projects', owned, 'settings'] : ['/projects'];
      case 'plan-on-board':
        return ['/boards'];
      case 'write-test-case':
        return owned ? ['/projects', owned, 'test-cases'] : ['/projects'];
      case 'run-regression':
        return owned ? ['/projects', owned, 'regressions'] : ['/projects'];
      case 'add-teammate':
        return ['/admin', 'users'];
      case 'enable-delegation':
        return ['/admin', 'agent-prompts'];
      case 'agent-token':
      case 'agent-connected':
        return ['/profile', 'tokens'];
      default:
        return ['/projects'];
    }
  }
}
