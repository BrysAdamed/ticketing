/// An entry of the top-bar Help menu, also offered as a command in the palette's Help group
/// (spec 14.6). Register it with `provideHelpMenuItem` or `HelpMenuRegistry.register`.
export interface HelpMenuItem {
  /// Palette command id, `help.<name>` (for example `help.tour.first-project`). The menu item's
  /// `data-testid` is the id with dots replaced by dashes (`help-tour-first-project`).
  id: string;
  label: string;
  /// An icon registered app-wide (`APP_ICONS`), because the menu and the palette live in the shell.
  icon: string;
  /// Position in the menu, ascending (`HELP_MENU_ORDER`); equal orders keep registration order.
  order: number;
  /// Shortcut shown next to the item (display only; bind keys with ShortcutService).
  shortcut?: string;
  keywords?: readonly string[];
  /// Short muted text at the end of the menu row (for example "3 of 8"); a signal works.
  hint?: () => string | null | undefined;
  /// Leaves the item out of the menu and the palette while false; a signal or computed works.
  visible?: () => boolean;
  /// Shows the menu item disabled and leaves it out of the palette while true.
  disabled?: () => boolean;
  /// False offers the item in the palette's Help group only (for example one command per tour).
  menu?: boolean;
  run: () => void;
}

export const HELP_GROUP = 'Help';

/// Menu positions of the items in spec 14.6. Restart all guides is not registered: the menu always
/// draws it last.
export const HELP_MENU_ORDER = {
  shortcuts: 0,
  tourOfPage: 100,
  firstProject: 200,
  gettingStarted: 300,
  whatsNew: 400,
  connectAgent: 500,
} as const;

export const SHORTCUTS_HELP_ID = 'help.shortcuts';
export const TOUR_OF_PAGE_ID = 'help.tour.page';
export const RESTART_GUIDES_ID = 'help.restart-guides';

export function helpItemTestId(item: Pick<HelpMenuItem, 'id'>): string {
  return item.id.replaceAll('.', '-');
}

export function isHelpItemVisible(item: HelpMenuItem): boolean {
  return item.visible?.() ?? true;
}

export function isHelpItemEnabled(item: HelpMenuItem): boolean {
  return isHelpItemVisible(item) && !(item.disabled?.() ?? false);
}
