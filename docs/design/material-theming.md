# Angular Material theming

How our tokens drive **Angular Material 22 + Angular CDK** (both MIT), so the app looks like Linear and not like stock Material. System and component token names were verified against `@angular/material` 21.2, the current major's API (`mat.theme`, `mat.theme-overrides`, `mat.<component>-overrides`). Re-check them when upgrading.

## 1. Strategy

- **`web/src/styles/_tokens.scss` is the single source of truth.** No hex values in the Material layer. `mat.theme` generates the `--mat-sys-*` scaffolding once, and `mat.theme-overrides` points every system color, typescale, shape, elevation and state value at a `--tk-*` variable.
- **Dark mode comes from our variables.** `_tokens.scss` flips `--tk-*` and `color-scheme` on `html[data-theme="dark"]`. Material reads `--mat-sys-*`, which resolve to `--tk-*`, so it follows the theme with no second theme emission. Values left at Material defaults use `light-dark()` (theme-type `color-scheme`), and those follow `color-scheme`, which our tokens also flip.
- **Material for form controls and overlays, CDK for everything that defines the product's feel.** Material contributes accessibility, focus management and overlay positioning. Our own components contribute density and the visual language (see §5).
- **Sizes and shapes come from component overrides**, not from density alone. Density `-2` is set globally (touch targets, list and checkbox geometry). The exact 28/32px control heights, 6px radii and 32px rows are pinned with `mat.<component>-overrides`.
- **No Material look**: no ripples, no pill buttons, no floating labels, no filled text fields, no tonal elevation tint, no Roboto, no Material Symbols.
- **Token prefix is `--tk-*`.** The snippet in `docs/research/tech-stack.md` uses `--tkt-*` and density `-1`. This document supersedes that snippet.

## 2. Bootstrapping

`app.config.ts`:

```ts
import { MAT_RIPPLE_GLOBAL_OPTIONS } from '@angular/material/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_TOOLTIP_DEFAULT_OPTIONS } from '@angular/material/tooltip';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: MAT_RIPPLE_GLOBAL_OPTIONS, useValue: { disabled: true } },
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic', hideRequiredMarker: true } },
    { provide: MAT_TOOLTIP_DEFAULT_OPTIONS, useValue: { showDelay: 500, hideDelay: 0, touchendHideDelay: 0, disableTooltipInteractivity: true } },
    { provide: MAT_SNACK_BAR_DEFAULT_OPTIONS, useValue: { duration: 5000, horizontalPosition: 'end', verticalPosition: 'bottom' } },
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { autoFocus: 'first-tabbable', restoreFocus: true, hasBackdrop: true, maxWidth: 'calc(100vw - 32px)' } },
  ],
};
```

Form field labels sit **above** the field as plain `<label>` elements (Linear style). Never use `<mat-label>` floating labels. Use `placeholder` for hints inside the field.

`index.html`: set `data-theme` before Angular boots, so the page does not flash in the wrong theme. The theme service mirrors the user preference to `localStorage`.

```html
<script>
  (function () {
    var p = null; try { p = localStorage.getItem('tk-theme'); } catch (e) {}
    var dark = p === 'dark' || ((!p || p === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  })();
</script>
```

`src/styles.scss` (order matters):

```scss
@use '@fontsource-variable/inter/wght.css';
@use 'styles/tokens';           // src/styles/_tokens.scss, the single source of truth
@use 'styles/material-theme';   // §3
@use 'styles/material-overrides'; // §4

*, *::before, *::after { box-sizing: border-box; }
html {
  font-family: var(--tk-font-sans);
  font-feature-settings: var(--tk-font-features);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
body {
  margin: 0;
  background: var(--tk-bg);
  color: var(--tk-text);
  font-size: var(--tk-text-base);
  line-height: var(--tk-leading-base);
}
:focus-visible { outline: 2px solid var(--tk-focus); outline-offset: 2px; }
.cdk-overlay-dark-backdrop { background: var(--tk-overlay-mask); }
```

## 3. System level: `_material-theme.scss`

```scss
@use '@angular/material' as mat;

html {
  @include mat.theme((
    color: (primary: mat.$violet-palette, theme-type: color-scheme),
    typography: (
      plain-family: var(--tk-font-sans),
      brand-family: var(--tk-font-sans),
      bold-weight: 600,
      medium-weight: 500,
      regular-weight: 400,
    ),
    density: -2,
  ));

  @include mat.theme-overrides((
    primary: var(--tk-accent),
    on-primary: var(--tk-text-on-solid),
    primary-container: var(--tk-accent-subtle),
    on-primary-container: var(--tk-accent-fg),
    inverse-primary: var(--tk-iris-300),
    secondary: var(--tk-text-muted),
    on-secondary: var(--tk-text-on-solid),
    secondary-container: var(--tk-bg-active),
    on-secondary-container: var(--tk-text),
    tertiary: var(--tk-accent),
    on-tertiary: var(--tk-text-on-solid),
    tertiary-container: var(--tk-accent-subtle),
    on-tertiary-container: var(--tk-accent-fg),
    error: var(--tk-danger),
    on-error: var(--tk-text-on-solid),
    error-container: var(--tk-danger-bg),
    on-error-container: var(--tk-danger-fg),
    background: var(--tk-bg),
    on-background: var(--tk-text),
    surface: var(--tk-surface),
    on-surface: var(--tk-text),
    surface-variant: var(--tk-bg-muted),
    on-surface-variant: var(--tk-text-muted),
    surface-dim: var(--tk-bg-subtle),
    surface-bright: var(--tk-surface),
    surface-container-lowest: var(--tk-bg),
    surface-container-low: var(--tk-bg-subtle),
    surface-container: var(--tk-surface-raised),
    surface-container-high: var(--tk-surface-raised),
    surface-container-highest: var(--tk-bg-muted),
    surface-tint: transparent,
    outline: var(--tk-border-input),
    outline-variant: var(--tk-border),
    inverse-surface: var(--tk-inverse-bg),
    inverse-on-surface: var(--tk-inverse-text),
    scrim: var(--tk-overlay-mask),
    shadow: rgb(0 0 0),

    body-large: var(--tk-weight-regular) var(--tk-text-base) #{'/'} var(--tk-leading-base) var(--tk-font-sans),
    body-large-size: var(--tk-text-base),
    body-large-line-height: var(--tk-leading-base),
    body-large-tracking: 0,
    body-medium: var(--tk-weight-regular) var(--tk-text-base) #{'/'} var(--tk-leading-base) var(--tk-font-sans),
    body-medium-size: var(--tk-text-base),
    body-medium-line-height: var(--tk-leading-base),
    body-medium-tracking: 0,
    body-small: var(--tk-weight-regular) var(--tk-text-sm) #{'/'} var(--tk-leading-sm) var(--tk-font-sans),
    body-small-size: var(--tk-text-sm),
    body-small-line-height: var(--tk-leading-sm),
    body-small-tracking: 0,
    label-large: var(--tk-weight-medium) var(--tk-text-base) #{'/'} var(--tk-leading-base) var(--tk-font-sans),
    label-large-size: var(--tk-text-base),
    label-large-line-height: var(--tk-leading-base),
    label-large-tracking: 0,
    label-medium-size: var(--tk-text-sm),
    label-medium-line-height: var(--tk-leading-sm),
    label-medium-tracking: 0,
    label-small-size: var(--tk-text-xs),
    label-small-line-height: var(--tk-leading-xs),
    label-small-tracking: 0,
    title-small-size: var(--tk-text-base),
    title-small-line-height: var(--tk-leading-base),
    title-small-tracking: 0,
    title-medium-size: var(--tk-text-lg),
    title-medium-line-height: var(--tk-leading-lg),
    title-medium-weight: var(--tk-weight-semibold),
    title-medium-tracking: 0,
    title-large-size: var(--tk-text-xl),
    title-large-line-height: var(--tk-leading-xl),
    title-large-weight: var(--tk-weight-semibold),
    title-large-tracking: var(--tk-tracking-tight),
    headline-small-size: var(--tk-text-lg),
    headline-small-line-height: var(--tk-leading-lg),
    headline-small-weight: var(--tk-weight-semibold),
    headline-small-tracking: 0,
    headline-medium-size: var(--tk-text-2xl),
    headline-medium-line-height: var(--tk-leading-2xl),
    headline-medium-weight: var(--tk-weight-semibold),
    headline-large-size: var(--tk-text-3xl),
    headline-large-line-height: var(--tk-leading-3xl),
    headline-large-weight: var(--tk-weight-semibold),

    corner-none: 0,
    corner-extra-small: var(--tk-radius-sm),
    corner-extra-small-top: var(--tk-radius-sm) var(--tk-radius-sm) 0 0,
    corner-small: var(--tk-radius-md),
    corner-medium: var(--tk-radius-lg),
    corner-large: var(--tk-radius-xl),
    corner-large-top: var(--tk-radius-xl) var(--tk-radius-xl) 0 0,
    corner-extra-large: var(--tk-radius-xl),
    corner-extra-large-top: var(--tk-radius-xl) var(--tk-radius-xl) 0 0,
    corner-full: var(--tk-radius-full),

    level0: none,
    level1: var(--tk-shadow-xs),
    level2: var(--tk-shadow-md),
    level3: var(--tk-shadow-md),
    level4: var(--tk-shadow-lg),
    level5: var(--tk-shadow-lg),

    hover-state-layer-opacity: 0.045,
    focus-state-layer-opacity: 0.08,
    pressed-state-layer-opacity: 0.1,
    dragged-state-layer-opacity: 0.12,
  ));
}
```

Typescale mapping: `body-large` and `body-medium` are 13/20 (inputs, options, table cells), `body-small` is 12/16, `label-large` is 13/20 500 (buttons, menu items), `title-medium` is 15/22 600 (section and dialog titles), `title-large` is 18/24 (page titles), `headline-*` is 15, 22 and 28. Display styles are unused.

## 4. Component level: `_material-overrides.scss`

```scss
@use '@angular/material' as mat;

html {
  @include mat.button-overrides((
    filled-container-height: 32px,
    filled-container-shape: var(--tk-radius-md),
    filled-horizontal-padding: 12px,
    filled-label-text-weight: var(--tk-weight-medium),
    outlined-container-height: 32px,
    outlined-container-shape: var(--tk-radius-md),
    outlined-horizontal-padding: 12px,
    outlined-outline-color: var(--tk-border-strong),
    outlined-label-text-color: var(--tk-text),
    text-container-height: 32px,
    text-container-shape: var(--tk-radius-md),
    text-horizontal-padding: 8px,
    text-label-text-color: var(--tk-text-muted),
    filled-touch-target-display: none,
    outlined-touch-target-display: none,
    text-touch-target-display: none,
    tonal-touch-target-display: none,
    protected-touch-target-display: none,
  ));

  @include mat.icon-button-overrides((
    state-layer-size: 28px,
    icon-size: 16px,
    container-shape: var(--tk-radius-md),
    icon-color: var(--tk-text-muted),
    touch-target-display: none,
  ));

  @include mat.form-field-overrides((
    container-height: 32px,
    container-vertical-padding: 6px,
    container-text-size: var(--tk-text-base),
    container-text-line-height: var(--tk-leading-base),
    container-text-tracking: 0,
    outlined-container-shape: var(--tk-radius-md),
    outlined-outline-color: var(--tk-border-input),
    outlined-hover-outline-color: var(--tk-border-input-hover),
    outlined-focus-outline-color: var(--tk-accent),
    outlined-focus-outline-width: 1px,
    outlined-input-text-placeholder-color: var(--tk-text-subtle),
    outlined-error-outline-color: var(--tk-danger),
    subscript-text-size: var(--tk-text-sm),
    subscript-text-line-height: var(--tk-leading-sm),
    error-text-color: var(--tk-danger-fg),
  ));

  @include mat.select-overrides((
    panel-background-color: var(--tk-surface-raised),
    container-elevation-shadow: var(--tk-shadow-md),
    trigger-text-size: var(--tk-text-base),
    enabled-arrow-color: var(--tk-text-subtle),
  ));

  @include mat.autocomplete-overrides((
    background-color: var(--tk-surface-raised),
    container-elevation-shadow: var(--tk-shadow-md),
    container-shape: var(--tk-radius-lg),
  ));

  @include mat.option-overrides((
    label-text-size: var(--tk-text-base),
    label-text-color: var(--tk-text),
    hover-state-layer-color: var(--tk-bg-hover),
    selected-state-layer-color: var(--tk-accent-subtle),
    selected-state-label-text-color: var(--tk-text),
  ));

  @include mat.menu-overrides((
    container-color: var(--tk-surface-raised),
    container-shape: var(--tk-radius-lg),
    container-elevation-shadow: var(--tk-shadow-md),
    item-label-text-size: var(--tk-text-base),
    item-label-text-weight: var(--tk-weight-regular),
    item-icon-size: 16px,
    item-icon-color: var(--tk-text-muted),
    item-leading-spacing: 8px,
    item-trailing-spacing: 8px,
    item-with-icon-leading-spacing: 8px,
    item-with-icon-trailing-spacing: 8px,
    item-spacing: 8px,
    divider-color: var(--tk-border),
  ));

  @include mat.dialog-overrides((
    container-color: var(--tk-surface-raised),
    container-shape: var(--tk-radius-xl),
    container-elevation-shadow: var(--tk-shadow-lg),
    headline-padding: 16px 20px 8px,
    content-padding: 0 20px 16px,
    with-actions-content-padding: 0 20px 16px,
    actions-padding: 12px 20px,
    subhead-size: var(--tk-text-lg),
    subhead-weight: var(--tk-weight-semibold),
    subhead-color: var(--tk-text),
    supporting-text-size: var(--tk-text-base),
    supporting-text-color: var(--tk-text-muted),
  ));

  @include mat.table-overrides((
    background-color: var(--tk-bg),
    header-container-height: 32px,
    row-item-container-height: 32px,
    header-headline-size: var(--tk-text-sm),
    header-headline-weight: var(--tk-weight-medium),
    header-headline-color: var(--tk-text-muted),
    row-item-label-text-size: var(--tk-text-base),
    row-item-outline-color: var(--tk-border-subtle),
  ));

  @include mat.tooltip-overrides((
    container-color: var(--tk-inverse-bg),
    supporting-text-color: var(--tk-inverse-text),
    supporting-text-size: var(--tk-text-sm),
    container-shape: var(--tk-radius-md),
  ));

  @include mat.checkbox-overrides((
    state-layer-size: 24px,
    touch-target-display: none,
    selected-icon-color: var(--tk-accent),
    selected-hover-icon-color: var(--tk-accent-hover),
    selected-focus-icon-color: var(--tk-accent),
    unselected-icon-color: var(--tk-border-input-hover),
    selected-checkmark-color: var(--tk-text-on-solid),
  ));

  @include mat.slide-toggle-overrides((
    track-width: 28px,
    track-height: 16px,
    track-outline-width: 0,
    selected-handle-size: 12px,
    unselected-handle-size: 12px,
    pressed-handle-size: 12px,
    with-icon-handle-size: 12px,
    selected-track-color: var(--tk-accent),
    selected-hover-track-color: var(--tk-accent-hover),
    selected-focus-track-color: var(--tk-accent),
    selected-pressed-track-color: var(--tk-accent-active),
    unselected-track-color: var(--tk-border-strong),
    unselected-hover-track-color: var(--tk-border-input-hover),
    unselected-focus-track-color: var(--tk-border-strong),
    unselected-pressed-track-color: var(--tk-border-input-hover),
    selected-handle-color: var(--tk-gray-0),
    unselected-handle-color: var(--tk-gray-0),
    selected-hover-handle-color: var(--tk-gray-0),
    unselected-hover-handle-color: var(--tk-gray-0),
    selected-focus-handle-color: var(--tk-gray-0),
    unselected-focus-handle-color: var(--tk-gray-0),
    selected-pressed-handle-color: var(--tk-gray-0),
    unselected-pressed-handle-color: var(--tk-gray-0),
    selected-icon-size: 0,
    unselected-icon-size: 0,
    state-layer-size: 24px,
    touch-target-display: none,
  ));

  @include mat.tabs-overrides((
    container-height: 36px,
    label-text-size: var(--tk-text-base),
    label-text-weight: var(--tk-weight-medium),
    active-indicator-height: 2px,
    active-indicator-color: var(--tk-accent),
    active-label-text-color: var(--tk-text),
    inactive-label-text-color: var(--tk-text-muted),
    divider-color: var(--tk-border),
  ));

  @include mat.snack-bar-overrides((
    container-color: var(--tk-surface-raised),
    supporting-text-color: var(--tk-text),
    supporting-text-size: var(--tk-text-base),
    button-color: var(--tk-accent-fg),
    container-shape: var(--tk-radius-lg),
  ));

  @include mat.progress-bar-overrides((
    active-indicator-color: var(--tk-accent),
    track-color: transparent,
    active-indicator-height: 2px,
    track-height: 2px,
  ));

  @include mat.sidenav-overrides((
    container-background-color: var(--tk-bg-sidebar),
    container-divider-color: var(--tk-border),
    container-shape: 0,
    content-background-color: var(--tk-bg),
    scrim-color: var(--tk-overlay-mask),
  ));
}

// The few things tokens cannot express.
.mat-mdc-form-field.mat-focused .mat-mdc-text-field-wrapper {
  box-shadow: 0 0 0 3px var(--tk-accent-subtle);
  border-radius: var(--tk-radius-md);
}
.mat-mdc-snack-bar-container .mdc-snackbar__surface {
  border: 1px solid var(--tk-border);
  box-shadow: var(--tk-shadow-md);
}
.mat-mdc-select-panel, .mat-mdc-autocomplete-panel, .mat-mdc-menu-panel {
  border: 1px solid var(--tk-border);
  padding: 4px !important;
}
.mat-mdc-option, .mat-mdc-menu-item { min-height: 28px !important; border-radius: var(--tk-radius-sm); }
```

Button mapping: `mat-flat-button` is **primary** (at most one per view), `mat-stroked-button` is **secondary**, `mat-button` is **ghost** and `mat-icon-button` is the 28px icon button. `mat-raised-button` and FABs are not used. For the 28px toolbar size (filters, header actions), wrap the toolbar in `.tk-dense`:

```scss
.tk-dense {
  @include mat.theme((density: -3));
  @include mat.button-overrides((filled-container-height: 28px, outlined-container-height: 28px, text-container-height: 28px));
  @include mat.form-field-overrides((container-height: 28px, container-vertical-padding: 4px));
}
```

| Element | Height | Source |
|---|---|---|
| Button / input / select (forms, dialogs) | 32px | overrides |
| Toolbar button / filter input (`.tk-dense`) | 28px | density -3 + overrides |
| Icon button | 28px | `state-layer-size` |
| Option / menu item | 28px | CSS min-height |
| `mat-table` row | 32px | `row-item-container-height` |

## 5. Material vs. our own (CDK)

| Need | Use | Why |
|---|---|---|
| Buttons, icon buttons | Material `MatButton`, `MatIconButton` | Focus, disabled and a11y handled; restyled via overrides |
| Text input, textarea, number | Material `MatFormField` + `MatInput` (outline, no label) | Validation and error display |
| Single select with fixed options (forms) | Material `MatSelect` | Keyboard and a11y handled |
| Version hint, labels input | Material `MatAutocomplete` + `MatChipGrid` | Free text with suggestions from previous values |
| Date (fields, token expiry) | Material `MatDatepicker` | Hard to build well |
| Checkbox, radio, toggle | Material `MatCheckbox`, `MatRadioGroup`, `MatSlideToggle` | Restyled to 16px, 28×16px toggle |
| User menu, row "…" menus | Material `MatMenu` | |
| Dialogs (create, confirm, show-once token) | Material `MatDialog` | Focus trap, restore focus |
| Tooltips | Material `MatTooltip` | |
| Toasts | Material `MatSnackBar.openFromComponent(TkToast)` | Our template (icon, text, Undo/Retry); Material handles the live region and queue |
| Admin tables (users, tokens, flags) | Material `MatTable` + `MatSort` | Small datasets, sorting needed |
| Profile tabs | Material `MatTabs` | |
| Background-load line | Material `MatProgressBar` (2px) | |
| Off-canvas sidebar under 900px | Material `MatSidenav` | Above 900px the sidebar is plain layout |
| **Command palette ⌘K** | CDK `Overlay` + `cdkListbox` + `ActiveDescendantKeyManager` | Grouped results, type-ahead, custom rows |
| **Inline property pickers** (status, priority, assignee, labels, type) | CDK `Overlay` (connected position) + `cdkListbox` + filter input | Command-menu style, 28px rows, digit shortcuts, multi-target (selection). `MatSelect` cannot host a filter input or render this compactly |
| **Backlog / test case / session lists** | CDK `ScrollingModule` (virtual scroll, fixed 32px) + `SelectionModel` + `CdkDrag` | 1,000+ rows, group headers, inline editing, drag rank. `MatTable` is too heavy |
| **Board** | CDK `cdkDropListGroup` / `cdkDropList` / `cdkDrag` | Columns × swimlanes, custom preview and placeholder |
| **Peek panel** | Plain layout + resize handle (CDK `DragDrop` on the handle) | It pushes content and stays interactive, so it is not a modal drawer |
| **Domain atoms**: `StatusIcon`, `TypeIcon`, `PriorityIcon`, `Badge`, `LabelChip`, `Avatar`, `Kbd`, `ProjectTile`, `Points` | Our components (plain SVG + tokens) | Pixel control. `MatChip` and `MatBadge` look like Material and are not used for domain values |
| **Segmented control**, filter chips, bulk action bar | Our components (CDK `A11yModule` for focus) | Visual language from the mockups |
| **Skeletons** | Our CSS component | No Material equivalent |
| **Markdown editor** | `<textarea cdkTextareaAutosize>` + our toolbar | |

Keyboard shortcuts are a small `ShortcutService` on `document` keydown. It is scope-aware and ignores events from editable targets. CDK `ListKeyManager` handles in-list navigation.

## 6. Icons

**Tabler Icons** (outline) via `@ng-icons/core` + `@ng-icons/tabler-icons`, both **MIT**. The versions are pinned in `docs/research/tech-stack.md`. We do **not** use Material Symbols, even though `mat-icon` supports it natively:

- Tabler's thin-stroke outline style on a 24px grid is the Linear/GitHub look. Material Symbols reads as "Google app", even at weight 300.
- Icons are tree-shaken per icon as inline SVG, so there is no icon font download and no flash of missing glyphs. A Material Symbols font is about 300 KB unless subset, and it is Apache 2.0 rather than MIT.
- Every domain glyph exists. The mapping is in design-system.md §8.

```html
<button mat-icon-button aria-label="Close" matTooltip="Close  Esc">
  <ng-icon name="tablerX" size="16" strokeWidth="1.75" />
</button>
<mat-form-field>
  <ng-icon matIconPrefix name="tablerSearch" size="14" />
  <input matInput placeholder="Filter by title or key" />
</mat-form-field>
```

Wrap `ng-icon` in a thin `TkIcon` component (fixed sizes 12/14/16/20, default stroke 1.75) so a future icon set swap touches one file. Do not register a `mat-icon` font.

## 7. Notes and pitfalls

- `mat.theme-overrides` silently ignores unknown system token names. After an upgrade, compare a computed `--mat-sys-*` variable in DevTools against the table above. Component `*-overrides` mixins fail the build on unknown keys, which is the safety net there.
- Animations: Material 20+ animates with CSS. Global `prefers-reduced-motion` is respected, and our motion tokens are not used by Material internals. Overlay enter/exit stays within 150ms by default, which matches our motion rules.
- Keep app styles unlayered, and never use `::ng-deep` to restyle Material. Change an override mixin first, and fall back to a global selector in `_material-overrides.scss` with a `TODO` explaining why.
- Charts do not go through Material. Read `--tk-*` directly (see design-system.md §9).
