import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { provideIcons } from '@ng-icons/core';
import { tablerSitemap } from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import {
  DOC_EDITOR_PLUGINS,
  DocEditorCommandContext,
  DocEditorPlugin,
  provideDocMarkdownEnhancer,
} from '@core/docs/doc-extensions';
import { renderMermaidBlocks } from '@shared/diagrams/mermaid/mermaid-blocks';
import { renderDiagramEmbeds } from './diagram-embeds';
import type { InsertDiagramData, InsertDiagramResult } from './insert-diagram.dialog';

const INLINE_MERMAID = 'flowchart LR\n  A[Start] --> B[Finish]';

/// Diagrams in docs (TKT-17): ```` ```mermaid ```` blocks in the reader and the editor preview
/// (lazy, theme-aware; the preview keeps a block's last good render while it has an error),
/// embedded diagram docs (`![caption](KEY)`) drawn with their format's renderer, and the editor's
/// "Diagram" toolbar button and `/` commands. Provided by the docs routes.
export function provideDocsDiagrams(): EnvironmentProviders {
  const lastGood = new WeakMap<HTMLElement, Map<number, string>>();
  return makeEnvironmentProviders([
    provideDocMarkdownEnhancer({
      id: 'mermaid',
      order: 10,
      enhance: (host, context) => {
        let previous: Map<number, string> | undefined;
        if (context.mode === 'preview') {
          previous = lastGood.get(host) ?? new Map();
          lastGood.set(host, previous);
        }
        return renderMermaidBlocks(host, context.theme, {
          signal: context.signal,
          lastGood: previous,
        });
      },
    }),
    provideDocMarkdownEnhancer({
      id: 'diagram-embeds',
      order: 20,
      enhance: (host, context) =>
        renderDiagramEmbeds(host, context.embeds, context.theme, context.signal),
    }),
    provideIcons({ tablerSitemap }),
    { provide: DOC_EDITOR_PLUGINS, useFactory: diagramEditorPlugin, multi: true },
  ]);
}

function diagramEditorPlugin(): DocEditorPlugin {
  const dialog = inject(MatDialog);
  const insertInline = (context: DocEditorCommandContext) => {
    const block = `\`\`\`mermaid\n${INLINE_MERMAID}\n\`\`\``;
    context.insertBlock(block, '```mermaid\n'.length + INLINE_MERMAID.length);
  };
  const pick = async (context: DocEditorCommandContext) => {
    const { InsertDiagramDialog } = await import('./insert-diagram.dialog');
    const ref = dialog.open<unknown, InsertDiagramData, InsertDiagramResult>(InsertDiagramDialog, {
      injector: context.injector,
      data: { projectKey: context.projectKey, docKey: context.docKey },
      width: '560px',
      autoFocus: 'first-tabbable',
      restoreFocus: false,
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return context.focus();
    if (result.kind === 'inline') return insertInline(context);
    context.insertBlock(`![${result.title.replace(/[[\]]/g, '')}](${result.key})`);
  };
  return {
    id: 'diagrams',
    order: 30,
    toolbar: [
      {
        id: 'diagram',
        label: 'Diagram',
        icon: 'tablerSitemap',
        hint: 'embed or Mermaid',
        run: pick,
      },
    ],
    slashCommands: [
      {
        id: 'mermaid',
        label: 'Mermaid diagram',
        icon: 'tablerSitemap',
        hint: 'inline',
        run: insertInline,
      },
      {
        id: 'embed-diagram',
        label: 'Embed diagram',
        icon: 'tablerSitemap',
        hint: 'pick or create',
        run: pick,
      },
    ],
  };
}
