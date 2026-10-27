import { codeLanguage, highlightCodeBlocks } from './highlight-code';
import { renderMarkdown } from './render-markdown';

describe('highlightCodeBlocks', () => {
  it('highlights known languages and leaves the others alone', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown(
      '```ts\nconst answer: number = 42;\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n```\nplain\n```',
    );

    // Act
    const count = await highlightCodeBlocks(root);
    const [ts, mermaid, plain] = [...root.querySelectorAll('pre > code')];

    // Assert
    expect(count).toBe(1);
    expect(ts.classList.contains('hljs')).toBe(true);
    expect(ts.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(ts.textContent).toBe('const answer: number = 42;\n');
    expect(mermaid.querySelector('span')).toBeNull();
    expect(plain.querySelector('span')).toBeNull();
  });

  it('escapes the code it highlights and does not highlight twice', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML = renderMarkdown('```html\n<img src=x onerror="alert(1)">\n```');

    // Act
    await highlightCodeBlocks(root);
    const again = await highlightCodeBlocks(root);

    // Assert
    expect(again).toBe(0);
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('reads the fence language', () => {
    const code = document.createElement('code');
    code.className = 'language-C#';
    expect(codeLanguage(code)).toBe('c#');
  });
});
