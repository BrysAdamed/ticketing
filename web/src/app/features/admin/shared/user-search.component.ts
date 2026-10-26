import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { UserLookup } from '../admin.models';

const DEBOUNCE_MS = 150;

/// Type-ahead over `GET /users` (email prefix or name word). Emits the picked user and clears.
@Component({
  selector: 'tk-user-search',
  imports: [MatAutocompleteModule, AvatarComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="box">
      <tk-icon name="tablerSearch" [size]="14" />
      <input
        #input
        type="text"
        [placeholder]="placeholder()"
        [attr.aria-label]="placeholder()"
        [attr.data-testid]="testId()"
        [matAutocomplete]="auto"
        (input)="onInput($any($event.target).value)"
        (focus)="onInput($any($event.target).value)"
      />
    </label>
    <mat-autocomplete
      #auto="matAutocomplete"
      (optionSelected)="select($event)"
      class="tk-user-search-panel"
    >
      @for (user of results(); track user.id) {
        <mat-option
          [value]="user"
          [disabled]="exclude().includes(user.id)"
          [attr.data-testid]="'user-option-' + user.email"
        >
          <span class="option">
            <tk-avatar
              [userId]="user.id"
              [name]="user.displayName"
              [size]="20"
              [showTitle]="false"
            />
            <span class="name">{{ user.displayName }}</span>
            <span class="email">{{ user.email }}</span>
          </span>
        </mat-option>
      }
    </mat-autocomplete>
  `,
  styles: `
    :host {
      display: block;
    }
    .box {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 10px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text-subtle);
    }
    :host(.compact) .box {
      height: 24px;
      padding: 0 8px;
      border-color: var(--tk-border);
    }
    .box:focus-within {
      border-color: var(--tk-accent);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
      font-size: var(--tk-text-sm);
    }
    .option {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .name {
      font-weight: var(--tk-weight-medium);
      white-space: nowrap;
    }
    .email {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
})
export class UserSearchComponent {
  private readonly api = inject(ApiClient);

  readonly placeholder = input('Add a user…');
  readonly exclude = input<readonly string[]>([]);
  readonly includeInactive = input(false);
  readonly testId = input<string | null>(null);
  readonly picked = output<UserLookup>();

  protected readonly results = signal<UserLookup[]>([]);
  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  protected onInput(text: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.search(text), DEBOUNCE_MS);
  }

  protected select(event: MatAutocompleteSelectedEvent): void {
    this.picked.emit(event.option.value as UserLookup);
    this.inputRef().nativeElement.value = '';
    this.results.set([]);
  }

  private async search(text: string): Promise<void> {
    const id = ++this.requestId;
    const users = await firstValueFrom(
      this.api.get<UserLookup[]>('/users', {
        query: text.trim(),
        includeInactive: this.includeInactive() || undefined,
      }),
    ).catch(() => [] as UserLookup[]);
    if (id === this.requestId) this.results.set(users);
  }
}
