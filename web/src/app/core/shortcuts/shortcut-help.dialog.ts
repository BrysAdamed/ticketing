import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { RegisteredShortcut, ShortcutService } from './shortcut.service';

interface Section {
  name: string;
  items: RegisteredShortcut[];
}

@Component({
  selector: 'tk-shortcut-help-dialog',
  imports: [MatDialogModule, KbdComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Keyboard shortcuts</h2>
    <mat-dialog-content>
      <label class="search">
        <tk-icon name="tablerSearch" [size]="14" />
        <input
          #filter
          type="search"
          placeholder="Search shortcuts"
          aria-label="Search shortcuts"
          data-testid="shortcut-help-search"
          (input)="query.set(filter.value)"
        />
      </label>
      @for (section of sections(); track section.name) {
        <section>
          <h3>{{ section.name }}</h3>
          @for (item of section.items; track item.id) {
            <div class="row">
              <span>{{ item.description }}</span>
              <span class="keys">
                @for (step of shortcuts.format(item.keys); track $index) {
                  @if (!$first) {
                    <span class="then">then</span>
                  }
                  <tk-kbd>{{ step }}</tk-kbd>
                }
              </span>
            </div>
          }
        </section>
      } @empty {
        <p class="empty">No shortcuts match.</p>
      }
    </mat-dialog-content>
  `,
  styles: `
    :host {
      display: block;
      width: 520px;
      max-width: 100%;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 32px;
      padding: 0 10px;
      margin-bottom: 8px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      color: var(--tk-text-subtle);
    }
    .search input {
      flex: 1;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
    }
    h3 {
      margin: 14px 0 4px;
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
      color: var(--tk-text-subtle);
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 30px;
      color: var(--tk-text);
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    .keys {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .then {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
    }
    .empty {
      color: var(--tk-text-muted);
    }
  `,
})
export class ShortcutHelpDialog {
  protected readonly shortcuts = inject(ShortcutService);
  protected readonly query = signal('');

  protected readonly sections = computed<Section[]>(() => {
    const query = this.query().trim().toLowerCase();
    const seen = new Set<string>();
    const sections = new Map<string, RegisteredShortcut[]>();
    for (const shortcut of [...this.shortcuts.shortcuts()].reverse()) {
      if (shortcut.showInHelp === false || seen.has(shortcut.keys)) continue;
      seen.add(shortcut.keys);
      if (query && !shortcut.description.toLowerCase().includes(query)) continue;
      const name = shortcut.section ?? 'General';
      sections.set(name, [...(sections.get(name) ?? []), shortcut]);
    }
    return [...sections.entries()].map(([name, items]) => ({ name, items: items.reverse() }));
  });
}
