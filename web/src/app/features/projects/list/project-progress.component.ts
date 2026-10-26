import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';

export interface CategoryCounts {
  toDo: number;
  inProgress: number;
  done: number;
}

/// 120×4 progress bar segmented by status category: done, in progress, to do (layout §3.1).
@Component({
  selector: 'tk-project-progress',
  imports: [MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', '[attr.aria-label]': 'label()' },
  template: `
    <span class="bar" [matTooltip]="label()">
      @if (counts().done) {
        <span class="seg done" [style.flex-grow]="counts().done"></span>
      }
      @if (counts().inProgress) {
        <span class="seg progress" [style.flex-grow]="counts().inProgress"></span>
      }
      @if (counts().toDo) {
        <span class="seg todo" [style.flex-grow]="counts().toDo"></span>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      height: 16px;
      flex: none;
    }
    .bar {
      width: 120px;
      height: 4px;
      display: flex;
      gap: 2px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-bg-muted);
      overflow: hidden;
      flex: none;
    }
    .seg {
      flex-basis: 0;
      min-width: 0;
    }
    .done {
      background: var(--tk-category-done);
    }
    .progress {
      background: var(--tk-category-inprogress);
    }
    .todo {
      background: var(--tk-category-todo);
    }
  `,
})
export class ProjectProgressComponent {
  readonly counts = input.required<CategoryCounts>();

  protected readonly total = computed(() => {
    const c = this.counts();
    return c.toDo + c.inProgress + c.done;
  });

  protected readonly label = computed(() => {
    const c = this.counts();
    return this.total() === 0
      ? 'No tickets yet'
      : `${c.done} done · ${c.inProgress} in progress · ${c.toDo} to do`;
  });
}
