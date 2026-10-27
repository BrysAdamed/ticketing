import type {
  MarkdownDocReference,
  MarkdownEmbed,
  MarkdownTicketReference,
} from '@shared/markdown/link-references';

/// A diagram embedded in a page: Mermaid with its source, Canvas with the bundle file of its
/// picture (null while it has none).
export interface PrintEmbed extends MarkdownEmbed {
  content: string | null;
  picture: string | null;
}

/// What a document may show of the keys it names, already filtered for the exporting user. Doc
/// links to documents of the same export point at `#KEY`; every other url is absolute.
export interface PrintReferences {
  tickets: MarkdownTicketReference[];
  docs: MarkdownDocReference[];
  embeds: PrintEmbed[];
}

/// One entry of the export in tree order. Folders (subfolders of an exported folder) only head
/// their documents; pages carry markdown, diagrams their Mermaid source or Canvas picture.
export interface PrintEntry {
  key: string;
  kind: 'Folder' | 'Page' | 'Diagram';
  diagramFormat: 'Mermaid' | 'Canvas' | null;
  title: string;
  /// 0 for a single document; 1 for the direct children of an exported folder.
  depth: number;
  version: number;
  path: string;
  updatedBy: string;
  updatedAt: string;
  content: string | null;
  picture: string | null;
  references: PrintReferences;
  /// Image urls of the markdown (`/api/v1/attachments/{id}`) mapped to bundle files.
  images: Record<string, string>;
}

/// The data the API writes into `index.html` (`#tk-print-data`) for one export (D-100).
export interface PrintData {
  mode: 'single' | 'folder';
  appUrl: string;
  projectKey: string;
  projectName: string;
  exportedBy: string;
  exportedAt: string;
  /// The exported folder (folder mode): the cover and contents describe it.
  folder: { key: string; title: string; path: string; documents: number } | null;
  entries: PrintEntry[];
}

export const PRINT_DATA_ID = 'tk-print-data';
