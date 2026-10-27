import {
  tablerArrowBackUp,
  tablerChalkboard,
  tablerFilePlus,
  tablerFolder,
  tablerFolderOpen,
  tablerFolderPlus,
  tablerFolderSymlink,
  tablerLink,
  tablerSitemap,
  tablerTrash,
} from '@ng-icons/tabler-icons';
import { DiagramFormat, DocKind } from '@core/docs/doc.models';

/// Icons used only by the Docs section, registered with `provideIcons` in its views.
export const DOCS_ICONS = {
  tablerArrowBackUp,
  tablerChalkboard,
  tablerFilePlus,
  tablerFolder,
  tablerFolderOpen,
  tablerFolderPlus,
  tablerFolderSymlink,
  tablerLink,
  tablerSitemap,
  tablerTrash,
};

export function docIcon(kind: DocKind, format: DiagramFormat | null = null, open = false): string {
  if (kind === 'Folder') return open ? 'tablerFolderOpen' : 'tablerFolder';
  if (kind === 'Diagram') return format === 'Canvas' ? 'tablerChalkboard' : 'tablerSitemap';
  return 'tablerFileText';
}
