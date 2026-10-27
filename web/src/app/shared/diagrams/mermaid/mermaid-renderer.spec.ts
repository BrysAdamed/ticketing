import { mermaidConfig } from './mermaid-config';
import { renderMermaid, renderMermaidBlocks, sanitizeSvg } from './mermaid-renderer';
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

describe('mermaidConfig', () => {
  it('locks the security-relevant keys against diagram directives', () => {
    // Act
    const config = mermaidConfig('light');

    // Assert
    expect(config.securityLevel).toBe('strict');
    expect(config.htmlLabels).toBe(false);
    expect(config.layout).toBe('dagre');
    expect(config.secure).toEqual(
      expect.arrayContaining(['securityLevel', 'htmlLabels', 'secure', 'dompurifyConfig']),
    );
  });

  it('uses plain hex colours that Mermaid can derive shades from', () => {
    for (const theme of ['light', 'dark'] as const) {
      // Act
      const variables = mermaidConfig(theme).themeVariables as Record<string, unknown>;

      // Assert
      const colours = Object.entries(variables).filter(([key]) => /color|background/i.test(key));
      expect(colours.length).toBeGreaterThan(5);
      for (const [, value] of colours) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('sanitizeSvg', () => {
  it('keeps Mermaid styling but removes active content', () => {
    // Arrange
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><style>#a{fill:red}</style>' +
      '<a href="javascript:alert(1)"><text onclick="alert(1)">x</text></a>' +
      '<foreignObject><div>html</div></foreignObject><script>alert(1)</script></svg>';

    // Act
    const clean = sanitizeSvg(svg);

    // Assert
    expect(clean).toContain('<style>');
    expect(unsafeSvgFindings(clean)).toEqual([]);
  });
});

describe('renderMermaid', { timeout: 30_000 }, () => {
  beforeAll(stubSvgLayout);

  it('renders a flowchart to SVG', async () => {
    // Act
    const result = await renderMermaid('flowchart LR\n  API --> DB', 'light');

    // Assert
    expect(result.error).toBeUndefined();
    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('API');
  });

  it('returns the parser message instead of throwing', async () => {
    // Act
    const result = await renderMermaid('flowchart LR\n  A -->', 'dark');

    // Assert
    expect(result.svg).toBeUndefined();
    expect(result.error).toMatch(/parse|expect/i);
  });

  it.each(Object.entries(MERMAID_SECURITY_SAMPLES))('renders %s inert', async (_, source) => {
    // Act
    const result = await renderMermaid(source, 'light');

    // Assert
    expect(result.error).toBeUndefined();
    expect(unsafeSvgFindings(result.svg ?? '')).toEqual([]);
  });
});

describe('renderMermaidBlocks', { timeout: 30_000 }, () => {
  beforeAll(stubSvgLayout);

  it('replaces valid blocks with figures and keeps invalid ones with an error box', async () => {
    // Arrange
    const root = document.createElement('div');
    root.innerHTML =
      '<pre><code class="language-mermaid">flowchart LR\n  A --> B</code></pre>' +
      '<pre><code class="language-mermaid">flowchart LR\n  A --></code></pre>' +
      '<pre><code class="language-ts">const a = 1;</code></pre>';

    // Act
    await renderMermaidBlocks(root, 'light');

    // Assert
    expect(root.querySelectorAll('figure.tk-mermaid svg')).toHaveLength(1);
    expect(root.querySelectorAll('.tk-mermaid-error')).toHaveLength(1);
    expect(root.querySelectorAll('pre')).toHaveLength(2);
  });
});
