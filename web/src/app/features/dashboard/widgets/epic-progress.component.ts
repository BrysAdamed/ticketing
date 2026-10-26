import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeekService } from '@core/layout/peek/peek';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { DashboardLinks } from '../dashboard-links';
import { EpicProgress, Progress } from '../dashboard.model';

const COLLAPSED = 6;

/// Widget 9: each open epic with two meters over its direct children, done/total by count and
/// by story points. The fill is the done-category green on a lighter step of the same ramp.
@Component({
  selector: 'tk-epic-progress',
  imports: [RouterLink, TypeIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head" aria-hidden="true">
      <span></span>
      <span>Tickets done</span>
      <span>Points done</span>
    </div>
    <ul aria-label="Open epics">
      @for (epic of visible(); track epic.key) {
        <li [attr.data-testid]="'epic-' + epic.key">
          <button type="button" class="epic" (click)="peek.open(epic.key)">
            <tk-type-icon type="Epic" [size]="14" />
            <span class="key">{{ epic.key }}</span>
            <span class="title" [title]="epic.title">{{ epic.title }}</span>
          </button>
          @for (meter of [epic.children, epic.points]; track $index) {
            <span class="meter">
              <span
                class="track"
                role="img"
                [attr.aria-label]="describe(meter, $index === 0 ? 'tickets' : 'points')"
              >
                <span class="fill" [style.width.%]="share(meter)"></span>
              </span>
              @if ($index === 0) {
                <a
                  class="value"
                  [routerLink]="links().children(epic.key, true).path"
                  [queryParams]="links().children(epic.key, true).query"
                  >{{ meter.done }}</a
                ><span class="of">/</span
                ><a
                  class="value"
                  [routerLink]="links().children(epic.key).path"
                  [queryParams]="links().children(epic.key).query"
                  >{{ meter.total }}</a
                >
              } @else {
                <span class="value">{{ meter.done }}</span
                ><span class="of">/</span><span class="value">{{ meter.total }}</span>
              }
            </span>
          }
        </li>
      }
    </ul>
    @if (epics().length > collapsed || openEpics() > epics().length) {
      <div class="more">
        @if (epics().length > collapsed) {
          <button type="button" class="link" (click)="expanded.set(!expanded())">
            {{ expanded() ? 'Show fewer' : 'Show all ' + epics().length }}
          </button>
        }
        @if (openEpics() > epics().length) {
          <span class="muted"
            >Top {{ epics().length }} of {{ openEpics() }} open epics by priority</span
          >
        }
      </div>
    }
  `,
  styleUrl: './epic-progress.component.scss',
})
export class EpicProgressComponent {
  protected readonly peek = inject(PeekService);

  readonly epics = input.required<readonly EpicProgress[]>();
  readonly openEpics = input.required<number>();
  readonly links = input.required<DashboardLinks>();

  protected readonly collapsed = COLLAPSED;
  protected readonly expanded = signal(false);
  protected readonly visible = computed(() =>
    this.expanded() ? this.epics() : this.epics().slice(0, COLLAPSED),
  );

  protected share(progress: Progress): number {
    return progress.total === 0 ? 0 : (progress.done / progress.total) * 100;
  }

  protected describe(progress: Progress, unit: string): string {
    return `${progress.done} of ${progress.total} ${unit} done`;
  }
}
