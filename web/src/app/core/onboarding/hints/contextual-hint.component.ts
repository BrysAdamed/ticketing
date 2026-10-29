import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { HintComponent } from '@shared/ui/hint/hint.component';
import { hintById, HintId } from '../guides/hints';
import { HintService } from './hint.service';

/// Places a contextual hint (spec 14.5) on a page or in a picker footer. It renders only when
/// `HintService` picks it: unseen, allowed for the user (`canWrite` for write hints), not covered
/// by another overlay or a tour step, and the first such hint on the page.
///
/// `<tk-contextual-hint hint="hint.free-transitions" [canWrite]="store.canWrite()" />`
@Component({
  selector: 'tk-contextual-hint',
  imports: [HintComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.shown]': 'shown()',
    '[class.compact]': 'compact()',
    '[attr.data-hint]': 'hint()',
  },
  template: `
    @if (shown()) {
      <tk-hint
        [attr.data-testid]="testId()"
        [title]="definition().title"
        [body]="definition().body"
        [compact]="compact()"
        [learnMoreLabel]="learnMoreLabel()"
        (dismissed)="dismiss()"
        (learnMore)="learnMore.emit()"
      />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    :host(:not(.shown)) {
      display: none;
    }
    :host(.compact) {
      margin-top: 4px;
    }
  `,
})
export class ContextualHintComponent {
  private readonly hints = inject(HintService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly token = signal<number | null>(null);

  readonly hint = input.required<HintId>();
  /// Whether the user can write where the hint is shown; hints about a write action need it.
  readonly canWrite = input(true);
  readonly compact = input(false, { transform: booleanAttribute });
  readonly learnMoreLabel = input<string | null>(null);

  readonly learnMore = output<void>();
  /// Emits when the hint appears or disappears, for pages that measure their layout.
  readonly shownChange = output<boolean>();

  protected readonly definition = computed(() => hintById(this.hint()));
  protected readonly testId = computed(() => this.hint().replace('.', '-'));
  protected readonly shown = computed(() => {
    const token = this.token();
    return token !== null && this.hints.visible() === token;
  });

  constructor() {
    effect((onCleanup) => {
      const definition = this.definition();
      const registration = untracked(() =>
        this.hints.register(definition, this.element.nativeElement, () => this.canWrite()),
      );
      this.token.set(registration.token);
      onCleanup(() => {
        registration.unregister();
        this.token.set(null);
      });
    });
    let previous = false;
    effect(() => {
      const shown = this.shown();
      if (shown !== previous) this.shownChange.emit(shown);
      previous = shown;
    });
  }

  protected dismiss(): void {
    void this.hints.dismiss(this.definition());
  }
}
