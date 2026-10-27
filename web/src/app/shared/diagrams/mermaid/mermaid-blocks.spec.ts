import { rememberHeight } from '../diagram-heights';
import { MERMAID_PLACEHOLDER_HEIGHT, mermaidHeightId, renderMermaidBlocks } from './mermaid-blocks';
import { loadMermaid, renderMermaid } from './mermaid-renderer';
import { MERMAID_SECURITY_SAMPLES, unsafeSvgFindings } from './mermaid-security.samples';

function stubSvgLayout(): void {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  proto['getBBox'] ??= function (this: SVGElement) {
    const length = (this.textContent ?? '').length;
    return { x: 0, y: 0, width: Math.max(8, length * 7), height: 16 };
  };
  proto['getComputedTextLength'] ??= function (this: SVGElement) {
    return (this.textContent ?? '').length * 7;
  };
}

function block(source: string): string {
  const escaped = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<pre><code class="language-mermaid">${escaped}</code></pre>`;
}

/// An IntersectionObserver that reports elements as visible only when the test says so.
class ManualObserver {
  static instances: ManualObserver[] = [];
  readonly observed = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    ManualObserver.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
  }
  show(element: Element): void {
    const entry = { target: element, isIntersecting: true } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

describe('renderMermaidBlocks', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    stubSvgLayout();
    await loadMermaid();
  }, 180_000);

  it('replaces valid blocks with figures and keeps invalid ones with an error box', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML =
      block('flowchart LR\n  A --> B') +
      block('flowchart LR\n  A -->') +
      '<pre><code class="language-ts">const a = 1;</code></pre>';

    // Act
    await renderMermaidBlocks(root, 'light', { lazy: false });

    // Assert
    expect(root.querySelectorAll('figure.tk-mermaid svg')).toHaveLength(1);
    const error = root.querySelector('.tk-mermaid-error');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toMatch(/Mermaid syntax error.*on line \d+/is);
    expect(root.querySelectorAll('pre')).toHaveLength(2);
  });

  it('renders the security samples inert inside markdown', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML = Object.values(MERMAID_SECURITY_SAMPLES).map(block).join('');

    // Act
    await renderMermaidBlocks(root, 'dark', { lazy: false });

    // Assert
    expect(root.querySelectorAll('figure.tk-mermaid')).toHaveLength(
      Object.keys(MERMAID_SECURITY_SAMPLES).length,
    );
    expect(unsafeSvgFindings(root.innerHTML)).toEqual([]);
  });

  it('keeps the last good render of a block that stops parsing (editor preview)', async () => {
    // Arrange
    const root = document.createElement('div');
    const lastGood = new Map<number, string>();
    root.innerHTML = block('flowchart LR\n  Good --> Render');
    await renderMermaidBlocks(root, 'light', { lazy: false, lastGood });

    // Act
    root.innerHTML = block('flowchart LR\n  Good -->');
    await renderMermaidBlocks(root, 'light', { lazy: false, lastGood });

    // Assert
    expect(root.querySelector('figure.tk-mermaid-stale svg')?.textContent).toContain('Render');
    expect(root.querySelector('.tk-mermaid-error')).not.toBeNull();
    expect(root.querySelector('pre > code.language-mermaid')).toBeNull();
  });

  it('replaces blocks rendered before synchronously, without waiting', async () => {
    // Arrange
    const source = 'flowchart LR\n  Sync --> Swap';
    await renderMermaid(source, 'light');
    const root = document.createElement('div');
    root.innerHTML = block(source);

    // Act
    void renderMermaidBlocks(root, 'light');

    // Assert
    expect(root.querySelector('figure.tk-mermaid svg')).not.toBeNull();
  });

  describe('lazily', () => {
    const original = globalThis.IntersectionObserver;

    beforeEach(() => {
      ManualObserver.instances = [];
      globalThis.IntersectionObserver = ManualObserver as unknown as typeof IntersectionObserver;
    });

    afterEach(() => {
      globalThis.IntersectionObserver = original;
    });

    it('reserves the remembered height and renders only when the block comes into view', async () => {
      // Arrange
      const seen = 'flowchart LR\n  Seen --> Before';
      rememberHeight(mermaidHeightId(seen), 321);
      const root = document.createElement('div');
      document.body.append(root);
      root.innerHTML = block(seen) + block('flowchart LR\n  Never --> Seen');

      // Act
      const done = renderMermaidBlocks(root, 'light');
      const [first, second] = Array.from(root.querySelectorAll('pre'));

      // Assert
      expect(first.classList).toContain('tk-mermaid-pending');
      expect(first.style.height).toBe('321px');
      expect(second.style.height).toBe(`${MERMAID_PLACEHOLDER_HEIGHT}px`);
      expect(root.querySelector('figure')).toBeNull();

      ManualObserver.instances.at(-1)!.show(first);
      ManualObserver.instances.at(-1)!.show(second);
      await done;
      expect(root.querySelectorAll('figure.tk-mermaid')).toHaveLength(2);
      expect(root.querySelector('.tk-mermaid-pending')).toBeNull();
      root.remove();
    });

    it('leaves pending blocks alone once the render is aborted', async () => {
      // Arrange
      const root = document.createElement('div');
      root.innerHTML = block('flowchart LR\n  Aborted --> Render');
      const controller = new AbortController();

      // Act
      const done = renderMermaidBlocks(root, 'light', { signal: controller.signal });
      controller.abort();
      await done;

      // Assert
      expect(root.querySelector('figure')).toBeNull();
    });
  });
});
