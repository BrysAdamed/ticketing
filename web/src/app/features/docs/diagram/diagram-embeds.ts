import { DocEmbed } from '@core/docs/doc.models';
import { rememberedHeight, rememberHeight } from '@shared/diagrams/diagram-heights';
import { DiagramTheme } from '@shared/diagrams/diagram-theme';
import { mermaidErrorBox } from '@shared/diagrams/mermaid/mermaid-blocks';
import { whenVisible } from '@shared/diagrams/when-visible';
import { INTERNAL_LINK_ATTR } from '@shared/markdown/render-markdown';
import { DIAGRAM_RENDERERS } from './diagram-renderers';

/// What an embedded diagram needs to render, from the doc's `embeds` (the readable diagrams the
/// server resolved for this reader).
export type EmbeddedDiagram = Pick<
  DocEmbed,
  'key' | 'title' | 'diagramFormat' | 'version' | 'content' | 'url' | 'snapshotUrl'
>;

export const EMBED_SELECTOR = 'figure.tk-doc-embed[data-doc-key]';

/// Draws the diagrams embedded in a page (`![caption](KEY)`, rendered by `renderMarkdown` as
/// `figure.tk-doc-embed` with an empty `.tk-doc-embed-body`) with the renderer of their format,
/// each when it comes near the viewport; the body keeps the diagram's remembered height until
/// then. Pictures (Canvas) fit the width and open the diagram on click. Embeds the viewer can't
/// read are not in `embeds` and keep their placeholder.
export async function renderDiagramEmbeds(
  root: ParentNode,
  embeds: readonly EmbeddedDiagram[],
  theme: DiagramTheme,
  signal?: AbortSignal,
): Promise<void> {
  const figures = Array.from(root.querySelectorAll<HTMLElement>(EMBED_SELECTOR));
  if (figures.length === 0) return;
  const byKey = new Map(embeds.map((embed) => [embed.key, embed]));
  await Promise.all(
    figures.map(async (figure) => {
      const body = figure.querySelector<HTMLElement>('.tk-doc-embed-body');
      const embed = byKey.get(figure.dataset['docKey'] ?? '');
      const renderer = embed?.diagramFormat ? DIAGRAM_RENDERERS[embed.diagramFormat] : undefined;
      if (!body || !embed || !renderer) return;
      const heightId = `doc:${embed.key}:${embed.version}`;
      const reserved = rememberedHeight(heightId);
      if (reserved) {
        body.style.boxSizing = 'border-box';
        body.style.minHeight = `${reserved}px`;
      }
      body.setAttribute('aria-busy', 'true');
      await whenVisible(figure, signal);
      if (signal?.aborted) return;
      const rendered = await renderer(embed, theme);
      if (signal?.aborted) return;
      body.removeAttribute('aria-busy');
      body.style.removeProperty('min-height');
      body.style.removeProperty('box-sizing');
      if ('error' in rendered) {
        body.replaceChildren(
          rendered.notice
            ? noticeOf(body.ownerDocument, rendered.error)
            : mermaidErrorBox(body.ownerDocument, rendered.error),
        );
        return;
      }
      const { element, width, height } = rendered;
      if (element instanceof HTMLElement || element instanceof SVGElement) {
        element.style.maxWidth = '100%';
        element.style.height = 'auto';
      }
      element.setAttribute('width', String(width));
      element.setAttribute('height', String(height));
      body.replaceChildren(
        element instanceof HTMLImageElement
          ? openLink(body.ownerDocument, embed, element)
          : element,
      );
      const measured = body.isConnected ? body.getBoundingClientRect().height : 0;
      if (measured > 0) rememberHeight(heightId, measured);
    }),
  );
}

function openLink(doc: Document, embed: EmbeddedDiagram, picture: HTMLImageElement): HTMLElement {
  const link = doc.createElement('a');
  link.className = 'tk-doc-embed-open';
  link.href = embed.url;
  link.title = `Open ${embed.title}`;
  link.setAttribute(INTERNAL_LINK_ATTR, '');
  picture.alt = embed.title;
  link.appendChild(picture);
  return link;
}

function noticeOf(doc: Document, text: string): HTMLElement {
  const notice = doc.createElement('p');
  notice.className = 'tk-doc-embed-notice';
  notice.setAttribute('data-testid', 'doc-embed-notice');
  notice.textContent = text;
  return notice;
}
