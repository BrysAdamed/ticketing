import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { paletteIndex } from '@shared/util/hash';
import { isOnce, MedalSize, pipPositions, tierColor } from './achievement-medal.logic';
import { MEDAL_GLYPHS, medalGlyph } from './medal-glyphs';

const GRID = 48;
const GRID_WITH_PIPS = 56;
const GLYPH_OFFSET = 15;
const GLYPH_SIZE = 18;

/// An achievement medal (design-system §8): a hexagon tinted from `--tk-palette-n`
/// (n = FNV-1a of the id), the catalogue's Tabler glyph, a ring in the tier colour and one pip
/// per tier reached; dashed and uncoloured while not earned. Pips are drawn from 32px up.
/// With `label` it is `role="img"`; without, it is decorative and the caller writes the name and
/// tier next to it.
@Component({
  selector: 'tk-achievement-medal',
  imports: [NgIcon],
  viewProviders: [provideIcons(MEDAL_GLYPHS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.locked]': 'locked()',
    '[class.once]': 'once()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'height()',
    '[style.--tk-medal]': 'palette()',
    '[style.--tk-medal-fg]': 'paletteFg()',
    '[style.--tk-medal-tier]': 'ringColor()',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label()',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    '[attr.data-tier]': 'tier()',
  },
  template: `
    <svg [attr.viewBox]="viewBox()" aria-hidden="true" focusable="false">
      @if (!locked()) {
        <path class="ring" d="M24 2 43.05 13v22L24 46 4.95 35V13Z" />
      }
      <path class="body" d="M24 6.5 39.16 15.25v17.5L24 41.5 8.84 32.75v-17.5Z" />
      @for (x of pips(); track $index) {
        <circle class="pip" [attr.cx]="x" cy="52.5" r="2.25" />
      }
    </svg>
    <ng-icon
      class="glyph"
      [name]="glyph()"
      [size]="glyphPx()"
      strokeWidth="2"
      [style.left.px]="glyphOffset()"
      [style.top.px]="glyphOffset()"
    />
  `,
  styles: `
    :host {
      position: relative;
      display: inline-block;
      flex: none;
      color: var(--tk-medal-fg);
    }
    :host(.locked) {
      color: var(--tk-text-subtle);
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .ring {
      fill: none;
      stroke: var(--tk-medal-tier);
      stroke-width: 2.5;
      stroke-linejoin: round;
    }
    :host(.once) .ring {
      stroke: var(--tk-medal);
      stroke-width: 1.25;
    }
    .body {
      fill: color-mix(in srgb, var(--tk-medal) var(--tk-tint-avatar), var(--tk-surface));
      stroke: var(--tk-medal);
      stroke-width: 1.25;
      stroke-linejoin: round;
    }
    :host(.locked) .body {
      fill: none;
      stroke: var(--tk-border-strong);
      stroke-width: 1.5;
      stroke-dasharray: 3.5 3;
    }
    .pip {
      fill: var(--tk-medal-tier);
    }
    .glyph {
      position: absolute;
      display: block;
      line-height: 0;
    }
  `,
})
export class AchievementMedalComponent {
  /// The catalogue id; null for a masked secret.
  readonly achievementId = input<string | null>(null);
  /// The catalogue's Tabler icon in kebab case (`file-plus`); null for a masked secret.
  readonly icon = input<string | null>(null);
  /// The highest tier earned, 0 for none.
  readonly tier = input(0);
  /// How many tiers the achievement has; 1 is a one-time achievement (thin ring, no pips).
  readonly tierCount = input(4);
  readonly size = input<MedalSize>(48);
  /// Accessible name ("Closer, Gold"), usually `medalLabel(…)`; null when the name and tier are
  /// written next to the medal.
  readonly label = input<string | null>(null);

  protected readonly locked = computed(() => this.tier() <= 0);
  protected readonly once = computed(
    () => !this.locked() && isOnce({ tier: this.tier(), tierCount: this.tierCount() }),
  );
  protected readonly withPips = computed(() => this.size() >= 32);
  protected readonly height = computed(() =>
    this.withPips() ? (this.size() * GRID_WITH_PIPS) / GRID : this.size(),
  );
  protected readonly viewBox = computed(
    () => `0 0 ${GRID} ${this.withPips() ? GRID_WITH_PIPS : GRID}`,
  );
  protected readonly pips = computed(() =>
    this.withPips() && !this.locked() && !this.once() ? pipPositions(this.tier()) : [],
  );
  private readonly paletteN = computed(() => {
    const id = this.achievementId();
    return id ? paletteIndex(id) : 0;
  });
  protected readonly palette = computed(() => `var(--tk-palette-${this.paletteN()})`);
  protected readonly paletteFg = computed(() => `var(--tk-palette-${this.paletteN()}-fg)`);
  protected readonly ringColor = computed(() => (this.locked() ? null : tierColor(this.tier())));
  protected readonly glyph = computed(() => medalGlyph(this.icon()));
  protected readonly glyphPx = computed(() => `${(this.size() * GLYPH_SIZE) / GRID}px`);
  protected readonly glyphOffset = computed(() => (this.size() * GLYPH_OFFSET) / GRID);
}
