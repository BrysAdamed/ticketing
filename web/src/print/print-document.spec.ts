import { PrintData, PrintEntry } from './print-data';
import { buildPrint, EMPTY_FOLDER } from './print-document';

const entry = (overrides: Partial<PrintEntry>): PrintEntry => ({
  key: 'PAY-D-1',
  kind: 'Page',
  diagramFormat: null,
  title: 'Payment flow',
  depth: 1,
  version: 3,
  path: 'Architecture / Payment flow',
  updatedBy: 'Jane Doe',
  updatedAt: '2026-10-27',
  content: '',
  picture: null,
  references: { tickets: [], docs: [], embeds: [] },
  images: {},
  ...overrides,
});

const data = (entries: PrintEntry[], mode: PrintData['mode'] = 'folder'): PrintData => ({
  mode,
  appUrl: 'https://tickets.example.com',
  projectKey: 'PAY',
  projectName: 'Payments',
  exportedBy: 'Jane Doe',
  exportedAt: '2026-10-27 16:40',
  folder:
    mode === 'folder'
      ? { key: 'PAY-D-9', title: 'Architecture', path: 'Architecture', documents: entries.length }
      : null,
  entries,
});

const render = (print: PrintData) => {
  const main = document.createElement('main');
  main.append(...buildPrint(document, print));
  return main;
};

describe('buildPrint', () => {
  it('puts a cover and a linked contents page in front of a folder, documents in tree order', () => {
    // Arrange
    const print = data([
      entry({ key: 'PAY-D-1', title: 'Overview' }),
      entry({ key: 'PAY-D-4', kind: 'Folder', title: 'Decisions', depth: 1 }),
      entry({ key: 'PAY-D-5', title: 'Use Postgres', depth: 2 }),
    ]);

    // Act
    const main = render(print);

    // Assert
    expect(main.querySelector('.cover-title')?.textContent).toBe('Architecture');
    expect(main.querySelector('.cover')?.textContent).toContain(
      'Exported by Jane Doe on 2026-10-27 16:40',
    );
    const links = Array.from(main.querySelectorAll<HTMLAnchorElement>('nav.toc a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#PAY-D-1', '#PAY-D-4', '#PAY-D-5']);
    expect(main.querySelector('nav.toc .toc-d2')?.textContent).toContain('Use Postgres');
    expect(Array.from(main.querySelectorAll('[id^="PAY-D-"]')).map((e) => e.id)).toEqual([
      'PAY-D-1',
      'PAY-D-4',
      'PAY-D-5',
    ]);
  });

  it('gives a single document only its title block, without cover or contents', () => {
    // Act
    const main = render(data([entry({ depth: 0 })], 'single'));

    // Assert
    expect(main.querySelector('.cover')).toBeNull();
    expect(main.querySelector('nav.toc')).toBeNull();
    expect(main.querySelector('.doc-title')?.textContent).toBe('Payment flow');
    expect(main.querySelector('.doc-meta')?.textContent).toBe(
      'PAY-D-1 · v3 · Last edited by Jane Doe on 2026-10-27 · Architecture / Payment flow',
    );
  });

  it('says so when a folder has no documents', () => {
    // Act
    const main = render(data([]));

    // Assert
    expect(main.querySelector('.empty')?.textContent).toBe(EMPTY_FOLDER);
  });

  it('keeps links to exported docs inside the PDF and makes app links absolute', () => {
    // Arrange
    const page = entry({
      content: [
        'See PAY-D-2 and PAY-D-3, ticket PAY-12, [the start](#overview) and [admin](/admin).',
        '',
        '## Overview',
      ].join('\n'),
      references: {
        tickets: [
          {
            key: 'PAY-12',
            title: 'Save the card',
            status: 'Done',
            url: 'https://tickets.example.com/tickets/PAY-12',
          },
        ],
        docs: [
          { key: 'PAY-D-2', title: 'Checkout', deleted: false, url: '#PAY-D-2' },
          {
            key: 'PAY-D-3',
            title: 'Refunds',
            deleted: false,
            url: 'https://tickets.example.com/p/PAY/docs/PAY-D-3/refunds',
          },
        ],
        embeds: [],
      },
    });

    // Act
    const main = render(data([page, entry({ key: 'PAY-D-2', title: 'Checkout' })]));

    // Assert
    const article = main.querySelector('article#PAY-D-1')!;
    const hrefs = Array.from(article.querySelectorAll('.tk-md a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '#PAY-D-2',
      'https://tickets.example.com/p/PAY/docs/PAY-D-3/refunds',
      'https://tickets.example.com/tickets/PAY-12',
      '#PAY-D-1--overview',
      'https://tickets.example.com/admin',
    ]);
    expect(article.querySelector('h2')?.id).toBe('PAY-D-1--overview');
    expect(article.querySelector('a.tk-anchor')).toBeNull();
    expect(article.querySelector('[target]')).toBeNull();
  });

  it('shows keys the exporter cannot read as plain text and unreadable embeds as placeholders', () => {
    // Arrange
    const page = entry({ content: 'Secret SEC-4 and SEC-D-2.\n\n![Plan](SEC-D-3)' });

    // Act
    const main = render(data([page], 'single'));

    // Assert
    const body = main.querySelector('.tk-md')!;
    expect(body.querySelector('a')).toBeNull();
    expect(body.textContent).toContain('Secret SEC-4 and SEC-D-2.');
    expect(body.querySelector('[data-testid="doc-embed-missing"]')?.textContent).toBe(
      'Diagram not available',
    );
  });

  it('points images at bundle files and turns any other image into its alt text', () => {
    // Arrange
    const page = entry({
      content:
        '![Flow](/api/v1/attachments/1f9b2c7e-0000-4000-8000-000000000001) ![Logo](https://evil.example/x.png)',
      images: { '/api/v1/attachments/1f9b2c7e-0000-4000-8000-000000000001': 'image-1.png' },
    });

    // Act
    const main = render(data([page], 'single'));

    // Assert
    const images = Array.from(main.querySelectorAll('img'));
    expect(images.map((i) => i.getAttribute('src'))).toEqual(['image-1.png']);
    expect(main.querySelector('.tk-md')?.textContent).toContain('[Logo]');
  });

  it('leaves an empty figure for diagram documents, drawn later', () => {
    // Act
    const main = render(
      data(
        [entry({ kind: 'Diagram', diagramFormat: 'Canvas', picture: 'canvas-1.svg' })],
        'single',
      ),
    );

    // Assert
    expect(main.querySelector('figure[data-print-diagram="PAY-D-1"]')).not.toBeNull();
    expect(main.querySelector('.tk-md')).toBeNull();
  });
});
