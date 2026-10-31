import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { tablerChalkboard, tablerFolder, tablerSitemap } from '@ng-icons/tabler-icons';
import { HighlightedTextComponent } from '@shared/ui/highlighted-text/highlighted-text.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { ShortcutService } from '../shortcuts/shortcut.service';
import { matchScore, PaletteItem, parsePaletteQuery } from './command';
import { CommandRegistry } from './command-registry';

const DEBOUNCE_MS = 120;
const MAX_PER_GROUP = 8;
const MAX_PER_GROUP_SCOPED = 20;
const COMMANDS_GROUP = 'Commands';

interface Group {
  name: string;
  items: { item: PaletteItem; index: number }[];
}

@Component({
  selector: 'tk-command-palette',
  imports: [HighlightedTextComponent, IconComponent, KbdComponent],
  viewProviders: [provideIcons({ tablerChalkboard, tablerFolder, tablerSitemap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'command-palette' },
  template: `
    <div class="search">
      <tk-icon name="tablerSearch" [size]="16" />
      <input
        #input
        type="text"
        role="combobox"
        aria-label="Search or jump to"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="tk-palette-list"
        placeholder="Search or jump to…"
        data-testid="command-palette-input"
        [attr.aria-activedescendant]="activeId()"
        (input)="onInput(input.value)"
        (keydown)="onKeydown($event)"
      />
      @if (loading()) {
        <span class="loading">Searching…</span>
      }
      <tk-kbd>Esc</tk-kbd>
    </div>
    <div id="tk-palette-list" class="list" role="listbox" aria-label="Results">
      @for (group of groups(); track group.name) {
        <div class="group" role="group" [attr.aria-label]="group.name">
          <div class="group-label">{{ group.name }}</div>
          @for (entry of group.items; track entry.item.id) {
            <div
              class="item"
              role="option"
              [id]="'tk-palette-' + entry.index"
              [class.active]="entry.index === active()"
              [class.two]="!!entry.item.snippet"
              [attr.aria-selected]="entry.index === active()"
              [attr.data-testid]="'palette-item-' + entry.item.id"
              (mouseenter)="select(entry.index)"
              (mousedown)="$event.preventDefault()"
              tabindex="-1"
              (click)="choose(entry.item)"
              (keydown.enter)="choose(entry.item)"
            >
              <tk-icon class="icon" [name]="entry.item.icon ?? 'tablerArrowRight'" [size]="16" />
              @if (entry.item.detail !== undefined || entry.item.snippet) {
                <span class="text">
                  <span class="line">
                    <tk-highlighted-text
                      class="label plain"
                      [text]="entry.item.label"
                      [ranges]="entry.item.labelHighlights ?? []"
                    />
                    @if (entry.item.detail) {
                      <span class="detail">{{ entry.item.detail }}</span>
                    }
                  </span>
                  @if (entry.item.snippet; as snippet) {
                    <tk-highlighted-text
                      class="snippet"
                      [text]="snippet.text"
                      [ranges]="snippet.highlights"
                    />
                  }
                </span>
              } @else {
                <span class="label">{{ entry.item.label }}</span>
              }
              @if (entry.item.hint) {
                <span class="hint">{{ entry.item.hint }}</span>
              }
              @if (entry.item.shortcut) {
                <span class="keys">
                  @for (step of shortcuts.format(entry.item.shortcut); track $index) {
                    <tk-kbd>{{ step }}</tk-kbd>
                  }
                </span>
              }
            </div>
          }
        </div>
      } @empty {
        <div class="empty">{{ loading() ? 'Searching…' : 'No results' }}</div>
      }
    </div>
    <div class="footer" data-testid="command-palette-footer">
      <span><tk-kbd>↑</tk-kbd> <tk-kbd>↓</tk-kbd> navigate</span>
      @for (scope of registry.scopes(); track scope.id) {
        <span
          class="scope"
          [class.active]="scope.id === parsed().scope?.id"
          [attr.data-testid]="'palette-scope-' + scope.id"
        >
          <tk-kbd>{{ scope.prefix }}</tk-kbd> {{ scope.hint }}
        </span>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      width: 640px;
      max-width: calc(100vw - 32px);
      max-height: 60vh;
      background: var(--tk-surface-raised);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-xl);
      box-shadow: var(--tk-shadow-lg);
      overflow: hidden;
      color: var(--tk-text);
    }
    .search {
      height: 48px;
      flex: none;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px 0 16px;
      border-bottom: 1px solid var(--tk-border);
      color: var(--tk-text-subtle);
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
      font-size: var(--tk-text-md);
    }
    input::placeholder {
      color: var(--tk-text-subtle);
    }
    .loading {
      font-size: var(--tk-text-sm);
    }
    .list {
      overflow-y: auto;
      padding: 4px 8px 8px;
    }
    .group-label {
      padding: 10px 8px 4px;
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
      color: var(--tk-text-subtle);
    }
    .item {
      height: 36px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 10px;
      border-radius: var(--tk-radius-md);
      cursor: pointer;
    }
    .item.two {
      height: 48px;
    }
    .item.active {
      background: var(--tk-bg-hover);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .line {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      white-space: nowrap;
    }
    .line .label {
      flex: none;
      max-width: 70%;
    }
    .detail,
    .snippet {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--tk-text-sm);
    }
    .detail {
      color: var(--tk-text-subtle);
    }
    .snippet {
      display: block;
      color: var(--tk-text-muted);
    }
    .icon {
      color: var(--tk-text-muted);
    }
    .label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      font-variant-numeric: tabular-nums;
    }
    .keys {
      display: flex;
      gap: 4px;
    }
    .empty {
      padding: 20px 8px;
      text-align: center;
      color: var(--tk-text-muted);
    }
    .footer {
      flex: none;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      padding: 8px 16px;
      border-top: 1px solid var(--tk-border-subtle);
      font-size: var(--tk-text-xs);
      color: var(--tk-text-subtle);
    }
    .footer span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .scope.active {
      color: var(--tk-accent-fg);
      font-weight: var(--tk-weight-medium);
    }
  `,
})
export class CommandPaletteComponent {
  protected readonly registry = inject(CommandRegistry);
  protected readonly shortcuts = inject(ShortcutService);

  readonly closed = output<void>();

  protected readonly query = signal('');
  private readonly chosenId = signal<string | null>(null);
  private readonly asyncResults = signal<ReadonlyMap<string, readonly PaletteItem[]>>(new Map());
  private readonly pending = signal(0);
  protected readonly loading = computed(() => this.pending() > 0);
  protected readonly parsed = computed(() =>
    parsePaletteQuery(this.query(), this.registry.scopes()),
  );

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  private readonly commandItems = computed<PaletteItem[]>(() => {
    const { text: query, scope } = this.parsed();
    if (scope) return [];
    return this.registry
      .commands()
      .filter((c) => c.available?.() ?? true)
      .map((c) => ({
        command: c,
        score: Math.max(
          matchScore(query, c.label),
          ...(c.keywords ?? []).map((k) => matchScore(query, k) - 50),
        ),
      }))
      .filter((x) => !query.trim() || x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ command }) => ({
        id: `command:${command.id}`,
        label: command.label,
        group: command.group ?? COMMANDS_GROUP,
        icon: command.icon,
        shortcut: command.shortcut,
        run: command.run,
      }));
  });

  private readonly syncResults = signal<ReadonlyMap<string, readonly PaletteItem[]>>(new Map());

  protected readonly groups = computed<Group[]>(() => {
    const all = [
      ...this.collect(this.syncResults()),
      ...this.collect(this.asyncResults()),
      ...this.commandItems(),
    ];
    const max = this.parsed().scope ? MAX_PER_GROUP_SCOPED : MAX_PER_GROUP;
    const byGroup = new Map<string, PaletteItem[]>();
    for (const item of all) {
      const list = byGroup.get(item.group) ?? [];
      if (list.length < max && !list.some((i) => i.id === item.id)) list.push(item);
      byGroup.set(item.group, list);
    }
    let index = 0;
    return [...byGroup.entries()].map(([name, items]) => ({
      name,
      items: items.map((item) => ({ item, index: index++ })),
    }));
  });

  private readonly flat = computed(() => this.groups().flatMap((g) => g.items.map((e) => e.item)));
  /// The item the user moved to stays active when results arriving later shift its position.
  protected readonly active = computed(() =>
    Math.max(
      0,
      this.flat().findIndex((item) => item.id === this.chosenId()),
    ),
  );
  protected readonly activeId = computed(() =>
    this.flat().length ? `tk-palette-${this.active()}` : null,
  );

  constructor() {
    afterNextRender(() => this.input().nativeElement.focus());

    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    inject(DestroyRef).onDestroy(() => {
      controller?.abort();
      if (timer) clearTimeout(timer);
    });

    effect(() => {
      const { text: query, scope } = this.parsed();
      const scopeId = scope?.id ?? null;
      const providers = this.registry
        .providers()
        .filter((p) => scopeId === null || (p.scopes ?? []).includes(scopeId))
        .filter((p) => query.trim().length >= (p.minQueryLength ?? 0));
      untracked(() => {
        controller?.abort();
        if (timer) clearTimeout(timer);
        const current = new AbortController();
        controller = current;
        this.syncResults.set(new Map());
        this.asyncResults.set(new Map());

        const run = (provider: (typeof providers)[number]) => {
          const result = provider.search(query, current.signal, scopeId);
          if (!(result instanceof Promise)) {
            this.syncResults.update((map) => new Map(map).set(provider.id, result));
            return;
          }
          this.pending.update((n) => n + 1);
          result
            .then((items) => {
              if (!current.signal.aborted) {
                this.asyncResults.update((map) => new Map(map).set(provider.id, items));
              }
            })
            .catch(() => undefined)
            .finally(() => {
              if (!current.signal.aborted) this.pending.update((n) => Math.max(0, n - 1));
            });
        };

        this.pending.set(0);
        providers.filter((p) => !p.remote).forEach(run);
        const remote = providers.filter((p) => p.remote);
        if (remote.length) timer = setTimeout(() => remote.forEach(run), DEBOUNCE_MS);
      });
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.flat().length;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count) this.select((this.active() + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count) this.select((this.active() - 1 + count) % count);
        break;
      case 'Enter': {
        event.preventDefault();
        const item = this.flat()[this.active()];
        if (item) this.choose(item);
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.closed.emit();
        break;
    }
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.chosenId.set(null);
  }

  protected select(index: number): void {
    this.chosenId.set(this.flat()[index]?.id ?? null);
  }

  protected choose(item: PaletteItem): void {
    this.closed.emit();
    item.run();
  }

  private collect(map: ReadonlyMap<string, readonly PaletteItem[]>): PaletteItem[] {
    return [...map.values()].flat();
  }
}
