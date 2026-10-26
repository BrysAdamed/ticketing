import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  Type,
  untracked,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { ShortcutService } from '../../shortcuts/shortcut.service';
import { ViewRegistry } from '../../views/view-registry';
import { PEEK_VIEW, PeekService } from './peek';

@Component({
  selector: 'tk-peek-panel',
  imports: [NgComponentOutlet, RouterLink, IconComponent, MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'complementary',
    '[attr.aria-label]': '"Ticket " + key()',
    'data-testid': 'peek-panel',
  },
  template: `
    <div class="bar">
      <span class="key tnum">{{ key() }}</span>
      <span class="spacer"></span>
      <a
        class="tk-icon-btn"
        aria-label="Open full page"
        matTooltip="Open full page"
        [routerLink]="['/tickets', key()]"
      >
        <tk-icon name="tablerArrowsMaximize" [size]="14" />
      </a>
      <button
        type="button"
        class="tk-icon-btn"
        aria-label="Close"
        matTooltip="Close  Esc"
        data-testid="peek-close"
        (click)="peek.close()"
      >
        <tk-icon name="tablerX" [size]="16" />
      </button>
    </div>
    <div class="body">
      @if (component(); as view) {
        <ng-container
          [ngComponentOutlet]="view"
          [ngComponentOutletInputs]="{ ticketKey: key(), presentation: 'peek' }"
        />
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: var(--tk-peek-w);
      max-width: 100%;
      height: 100%;
      min-height: 0;
      border-left: 1px solid var(--tk-border);
      background: var(--tk-bg);
      box-shadow: var(--tk-shadow-lg);
    }
    .bar {
      height: 40px;
      flex: none;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 8px 0 16px;
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    .key {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .spacer {
      flex: 1;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
  `,
})
export class PeekPanelComponent {
  protected readonly peek = inject(PeekService);
  private readonly registry = inject(ViewRegistry);
  private readonly view = inject(PEEK_VIEW, { optional: true });

  protected readonly key = computed(() => this.peek.ticketKey() ?? '');
  protected readonly component = signal<Type<unknown> | null>(null);

  constructor() {
    inject(ShortcutService).registerScoped([
      {
        keys: 'escape',
        description: 'Close the peek panel',
        handler: () => this.peek.close(),
        showInHelp: false,
      },
    ]);

    const view = this.view;
    if (view) void this.registry.resolve(view).then((component) => this.component.set(component));

    effect(() => {
      const ready = this.key() !== '' && this.component() !== null;
      if (ready && view) untracked(() => this.registry.reportExposure(view.viewId));
    });
  }
}
