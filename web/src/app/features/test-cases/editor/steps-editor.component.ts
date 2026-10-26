import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { ChangeDetectionStrategy, Component, ElementRef, input, model, viewChildren } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { FormStep, MAX_STEPS, moveStep, newStep, STEP_MAX } from './test-case-form';

/// Ordered list of test steps: drag to reorder, Enter adds a step below, Backspace on an empty step
/// removes it, Alt+↑/↓ moves the focused step.
@Component({
  selector: 'tk-steps-editor',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, CdkTextareaAutosize, MatTooltip, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'steps-editor' },
  template: `
    <ol class="steps" cdkDropList [cdkDropListDisabled]="disabled()" (cdkDropListDropped)="dropped($event)">
      @for (step of steps(); track step.id; let i = $index) {
        <li class="step" cdkDrag cdkDragLockAxis="y" [attr.data-testid]="'step-' + i">
          <span class="grip" cdkDragHandle [class.hidden]="disabled()" aria-hidden="true"><tk-icon name="tablerGripVertical" [size]="14" /></span>
          <span class="n tnum">{{ i + 1 }}.</span>
          <textarea
            #stepInput
            cdkTextareaAutosize
            [cdkAutosizeMinRows]="1"
            [cdkAutosizeMaxRows]="8"
            rows="1"
            [attr.maxlength]="maxLength"
            [attr.aria-label]="'Step ' + (i + 1)"
            [attr.data-testid]="'step-input-' + i"
            [disabled]="disabled()"
            [value]="step.text"
            placeholder="Describe the action…"
            (input)="edit(i, $any($event.target).value)"
            (keydown)="onKeydown($event, i)"
          ></textarea>
          @if (!disabled()) {
            <span class="acts">
              <button type="button" class="tk-icon-btn tk-icon-btn-sm" matTooltip="Move up  Alt ↑" [attr.aria-label]="'Move step ' + (i + 1) + ' up'" [disabled]="i === 0" (click)="move(i, -1)">
                <tk-icon name="tablerArrowUp" [size]="14" />
              </button>
              <button type="button" class="tk-icon-btn tk-icon-btn-sm" matTooltip="Move down  Alt ↓" [attr.aria-label]="'Move step ' + (i + 1) + ' down'" [disabled]="i === steps().length - 1" (click)="move(i, 1)">
                <tk-icon name="tablerArrowDown" [size]="14" />
              </button>
              <button type="button" class="tk-icon-btn tk-icon-btn-sm" matTooltip="Remove step" [attr.aria-label]="'Remove step ' + (i + 1)" [attr.data-testid]="'step-remove-' + i" (click)="remove(i)">
                <tk-icon name="tablerTrash" [size]="14" />
              </button>
            </span>
          }
        </li>
      }
    </ol>
    @if (!disabled() && steps().length < maxSteps) {
      <button type="button" class="add" data-testid="step-add" (click)="add(steps().length)">
        <tk-icon name="tablerPlus" [size]="14" />Add step
      </button>
    }
    @if (disabled() && steps().length === 0) {
      <div class="empty">No steps.</div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .steps {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 3px 0;
      background: var(--tk-surface);
    }
    .grip {
      width: 16px;
      height: 26px;
      display: grid;
      place-items: center;
      color: var(--tk-text-subtle);
      cursor: grab;
    }
    .grip.hidden {
      visibility: hidden;
    }
    .n {
      width: 22px;
      flex: none;
      padding-top: 5px;
      color: var(--tk-text-muted);
      text-align: right;
    }
    textarea {
      flex: 1;
      min-width: 0;
      min-height: 26px;
      padding: 4px 8px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text);
      font: inherit;
      resize: none;
      overflow: hidden;
      outline: 0;
    }
    textarea:focus {
      border-color: var(--tk-accent);
    }
    textarea:disabled {
      border-color: transparent;
      background: none;
      color: var(--tk-text);
    }
    .acts {
      display: flex;
      gap: 0;
      opacity: 0;
      padding-top: 1px;
    }
    .step:hover .acts,
    .step:focus-within .acts {
      opacity: 1;
    }
    .add {
      height: 26px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin: 4px 0 0 44px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      cursor: pointer;
    }
    .add:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    .empty {
      color: var(--tk-text-subtle);
    }
    .cdk-drag-preview {
      box-shadow: var(--tk-shadow-md);
      border-radius: var(--tk-radius-md);
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
    }
  `,
})
export class StepsEditorComponent {
  readonly steps = model.required<readonly FormStep[]>();
  readonly disabled = input(false);

  protected readonly maxLength = STEP_MAX;
  protected readonly maxSteps = MAX_STEPS;
  private readonly inputs = viewChildren<ElementRef<HTMLTextAreaElement>>('stepInput');

  protected edit(index: number, text: string): void {
    this.steps.update((steps) => steps.map((s, i) => (i === index ? { ...s, text } : s)));
  }

  protected add(index: number): void {
    if (this.steps().length >= MAX_STEPS) return;
    this.steps.update((steps) => [...steps.slice(0, index), newStep(), ...steps.slice(index)]);
    this.focus(index);
  }

  protected remove(index: number): void {
    this.steps.update((steps) => steps.filter((_, i) => i !== index));
    this.focus(Math.max(0, index - 1));
  }

  protected move(index: number, delta: number): void {
    const to = index + delta;
    if (to < 0 || to >= this.steps().length) return;
    this.steps.update((steps) => moveStep(steps, index, to));
    this.focus(to);
  }

  protected dropped(event: CdkDragDrop<unknown>): void {
    this.steps.update((steps) => moveStep(steps, event.previousIndex, event.currentIndex));
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const target = event.target as HTMLTextAreaElement;
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.add(index + 1);
    } else if (event.key === 'Backspace' && target.value === '' && this.steps().length > 0) {
      event.preventDefault();
      this.remove(index);
    } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      this.move(index, event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  private focus(index: number): void {
    setTimeout(() => this.inputs()[index]?.nativeElement.focus());
  }
}
