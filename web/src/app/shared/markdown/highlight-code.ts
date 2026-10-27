type Highlighter = typeof import('./highlight-languages').default;

const HIGHLIGHTED_ATTR = 'data-tk-highlighted';
let highlighter: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  highlighter ??= import('./highlight-languages').then((m) => m.default);
  return highlighter;
}

/// The fenced language of a rendered code block (`<code class="language-ts">`), lower case.
export function codeLanguage(code: Element): string | null {
  const match = /(?:^|\s)language-([\w#+.-]+)/.exec(code.className);
  return match ? match[1].toLowerCase() : null;
}

/// Syntax-highlights the fenced code blocks under `root` that name a known language
/// (```` ```ts ````), loading highlight.js lazily only when there is one. Blocks of unknown
/// languages (and ```` ```mermaid ````) are left as they are. Free of Angular so the PDF print
/// bundle can call it too. Resolves with the number of blocks highlighted.
export async function highlightCodeBlocks(root: ParentNode): Promise<number> {
  const blocks = Array.from(root.querySelectorAll('pre > code')).filter(
    (code) => !code.hasAttribute(HIGHLIGHTED_ATTR) && codeLanguage(code),
  );
  if (blocks.length === 0) return 0;
  const hljs = await loadHighlighter();
  let count = 0;
  for (const code of blocks) {
    const language = codeLanguage(code)!;
    if (!hljs.getLanguage(language)) continue;
    const result = hljs.highlight(code.textContent ?? '', { language, ignoreIllegals: true });
    code.innerHTML = result.value;
    code.classList.add('hljs');
    code.setAttribute(HIGHLIGHTED_ATTR, '');
    count++;
  }
  return count;
}
