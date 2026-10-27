import { DIAGRAM_NOT_AVAILABLE, MarkdownReferences } from './link-references';
import { INTERNAL_LINK_ATTR, renderMarkdown } from './render-markdown';

const parse = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
};

const references: MarkdownReferences = {
  tickets: [
    { key: 'PAY-12', title: 'Save the card', status: 'InProgress', url: '/tickets/PAY-12' },
  ],
  docs: [
    {
      key: 'PAY-D-3',
      title: 'Payment flow',
      deleted: false,
      url: '/p/PAY/docs/PAY-D-3/payment-flow',
    },
    { key: 'PAY-D-7', title: 'Checkout', deleted: false, url: '/p/PAY/docs/PAY-D-7/checkout' },
    { key: 'PAY-D-9', title: null, deleted: true, url: null },
  ],
  embeds: [
    {
      key: 'PAY-D-7',
      title: 'Checkout',
      diagramFormat: 'Mermaid',
      version: 4,
      url: '/p/PAY/docs/PAY-D-7/checkout',
    },
  ],
};

const render = (source: string, refs: MarkdownReferences | null = references) =>
  parse(renderMarkdown(source, { references: refs }));

describe('linkReferences', () => {
  it('renders a readable ticket as a chip with its status and the title on hover', () => {
    // Act
    const chip = render('Work in PAY-12.').querySelector<HTMLAnchorElement>('a.tk-tref');

    // Assert
    expect(chip?.getAttribute('href')).toBe('/tickets/PAY-12');
    expect(chip?.classList).toContain('tk-tref-inprogress');
    expect(chip?.title).toBe('PAY-12 · Save the card (In Progress)');
    expect(chip?.querySelector('svg')).not.toBeNull();
    expect(chip?.textContent).toBe('PAY-12');
    expect(chip?.hasAttribute(INTERNAL_LINK_ATTR)).toBe(true);
  });

  it('renders unreadable or unknown keys as plain text without title or status', () => {
    // Act
    const dom = render('Secret SEC-4 and SEC-D-2, [the plan](SEC-D-5) and [task](SEC-9).');

    // Assert
    expect(dom.querySelectorAll('a').length).toBe(0);
    expect(dom.textContent?.trim()).toBe('Secret SEC-4 and SEC-D-2, the plan and task.');
  });

  it('links doc keys and [text](KEY) to the doc with its title on hover', () => {
    // Act
    const links = [...render('See PAY-D-3 and [the flow](PAY-D-3).').querySelectorAll('a')];

    // Assert
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.title])).toEqual([
      ['PAY-D-3', '/p/PAY/docs/PAY-D-3/payment-flow', 'Payment flow'],
      ['the flow', '/p/PAY/docs/PAY-D-3/payment-flow', 'Payment flow'],
    ]);
    expect(links.every((a) => a.classList.contains('tk-docref'))).toBe(true);
  });

  it('strikes deleted docs through', () => {
    // Act
    const dom = render('Old: PAY-D-9 and [design](PAY-D-9).');

    // Assert
    const deleted = [...dom.querySelectorAll('.tk-docref-deleted')];
    expect(deleted.map((d) => d.textContent)).toEqual(['PAY-D-9 (deleted)', 'design (deleted)']);
    expect(deleted.every((d) => d.querySelector('s'))).toBe(true);
    expect(dom.querySelector('a')).toBeNull();
  });

  it('turns a readable diagram embed into a figure for the diagram renderers', () => {
    // Act
    const dom = render('Intro\n\n![The checkout](PAY-D-7)\n\nAfter');
    const figure = dom.querySelector('figure.tk-doc-embed');

    // Assert
    expect(figure?.getAttribute('data-doc-key')).toBe('PAY-D-7');
    expect(figure?.getAttribute('data-diagram-format')).toBe('Mermaid');
    expect(figure?.getAttribute('data-version')).toBe('4');
    expect(figure?.querySelector('.tk-doc-embed-body')).not.toBeNull();
    expect(figure?.querySelector('a.tk-doc-embed-title')?.getAttribute('href')).toBe(
      '/p/PAY/docs/PAY-D-7/checkout',
    );
    expect(figure?.querySelector('figcaption')?.textContent).toBe('The checkout');
    expect(figure?.parentElement?.tagName).toBe('DIV');
    expect(dom.querySelector('img')).toBeNull();
  });

  it('shows "Diagram not available" for an unreadable, deleted or unknown diagram embed', () => {
    // Act
    const dom = render('![Secret topology](SEC-D-2)\n\n![Gone](PAY-D-9)');

    // Assert
    const missing = [...dom.querySelectorAll('figure.tk-doc-embed-missing')];
    expect(missing.map((f) => f.textContent)).toEqual([
      DIAGRAM_NOT_AVAILABLE,
      DIAGRAM_NOT_AVAILABLE,
    ]);
    expect(dom.textContent).not.toContain('SEC-D-2');
    expect(dom.textContent).not.toContain('Secret topology');
    expect(dom.querySelector('img')).toBeNull();
  });

  it('links unresolved keys plainly in the editor preview', () => {
    // Act
    const dom = render('New NEW-3 and NEW-D-4', { ...references, unresolved: 'link' });

    // Assert
    expect([...dom.querySelectorAll('a.tk-keyref')].map((a) => a.getAttribute('href'))).toEqual([
      '/tickets/NEW-3',
      '/docs/NEW-D-4',
    ]);
  });

  it('links every key by route outside docs, embeds included', () => {
    // Act
    const dom = render('PAY-12, PAY-D-3, [doc](PAY-D-5) and ![x](PAY-D-7)', null);

    // Assert
    expect([...dom.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/tickets/PAY-12',
      '/docs/PAY-D-3',
      '/docs/PAY-D-5',
      '/docs/PAY-D-7',
    ]);
    expect(dom.querySelector('img, figure')).toBeNull();
  });

  it('leaves keys in code alone', () => {
    // Act
    const dom = render('`PAY-12` and\n\n```\nPAY-D-3\n```');

    // Assert
    expect(dom.querySelectorAll('a').length).toBe(0);
  });
});
