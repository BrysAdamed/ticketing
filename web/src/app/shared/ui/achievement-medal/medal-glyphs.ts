import {
  tablerArchive,
  tablerAward,
  tablerBug,
  tablerBugOff,
  tablerChecklist,
  tablerCircleCheck,
  tablerFilePlus,
  tablerGitPullRequest,
  tablerLayoutKanban,
  tablerLink,
  tablerListCheck,
  tablerMessages,
  tablerPaperclip,
  tablerPlugConnected,
  tablerQuestionMark,
  tablerRobot,
  tablerTestPipe,
  tablerUserShare,
  tablerZoomExclamation,
} from '@ng-icons/tabler-icons';

export const MEDAL_FALLBACK_GLYPH = 'tablerAward';
export const MEDAL_SECRET_GLYPH = 'tablerQuestionMark';

/// Glyphs of the achievement catalogue (spec 15.2), keyed by ng-icons name. A catalogue icon
/// missing here draws the award glyph, so add the icon when you add an achievement.
export const MEDAL_GLYPHS: Readonly<Record<string, string>> = {
  tablerArchive,
  tablerAward,
  tablerBug,
  tablerBugOff,
  tablerChecklist,
  tablerCircleCheck,
  tablerFilePlus,
  tablerGitPullRequest,
  tablerLayoutKanban,
  tablerLink,
  tablerListCheck,
  tablerMessages,
  tablerPaperclip,
  tablerPlugConnected,
  tablerQuestionMark,
  tablerRobot,
  tablerTestPipe,
  tablerUserShare,
  tablerZoomExclamation,
};

/// The ng-icons name of a catalogue icon in Tabler kebab case (`file-plus` → `tablerFilePlus`):
/// the secret glyph for a masked entry (null), the award glyph for an icon not registered here.
export function medalGlyph(icon: string | null): string {
  if (!icon) return MEDAL_SECRET_GLYPH;
  const name =
    'tabler' +
    icon
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');
  return name in MEDAL_GLYPHS ? name : MEDAL_FALLBACK_GLYPH;
}
