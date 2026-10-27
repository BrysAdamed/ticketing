import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DocEditor } from '@core/docs/doc.models';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';

/// "Jane is editing": the other users with a draft of the doc changed in the last 10 minutes
/// (spec 1.7). Renders nothing when nobody else is editing.
@Component({
  selector: 'tk-doc-presence',
  imports: [AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.hidden]': '!editors().length' },
  template: `
    @if (editors().length) {
      <span class="avs" aria-hidden="true">
        @for (editor of shown(); track editor.user.id) {
          <tk-avatar [userId]="editor.user.id" [name]="editor.user.displayName" [size]="20" />
        }
      </span>
      <span data-testid="doc-presence">{{ label() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
    }
    :host(.hidden) {
      display: none;
    }
    .avs {
      display: inline-flex;
    }
    .avs tk-avatar + tk-avatar {
      margin-left: -6px;
    }
    .avs tk-avatar {
      box-shadow: 0 0 0 2px var(--tk-bg);
    }
  `,
})
export class DocPresenceComponent {
  readonly editors = input.required<readonly DocEditor[]>();

  protected readonly shown = computed(() => this.editors().slice(0, 3));
  protected readonly label = computed(() => presenceLabel(this.editors()));
}

export function presenceLabel(editors: readonly DocEditor[]): string {
  const names = editors.map((e) => e.user.displayName);
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is editing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are editing`;
  return `${names[0]} and ${names.length - 1} others are editing`;
}
