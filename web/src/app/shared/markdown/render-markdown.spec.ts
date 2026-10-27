import { INTERNAL_LINK_ATTR, renderMarkdown } from './render-markdown';

const parse = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
};

describe('renderMarkdown', () => {
  it('renders GFM (tables, task lists, strikethrough)', () => {
    // Arrange
    const source = '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~';

    // Act
    const dom = parse(renderMarkdown(source));

    // Assert
    expect(dom.querySelector('table td')?.textContent).toBe('1');
    expect(dom.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    expect(dom.querySelector('del')?.textContent).toBe('old');
  });

  it('does not render raw HTML', () => {
    // Act
    const dom = parse(renderMarkdown('<b>bold</b> and <img src=x onerror="alert(1)">'));

    // Assert
    expect(dom.querySelector('b')).toBeNull();
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.textContent).toContain('<b>bold</b>');
  });

  it('strips script and javascript: URLs', () => {
    // Act
    const html = renderMarkdown('[click](javascript:alert(1))\n\n<script>alert(1)</script>');
    const dom = parse(html);

    // Assert
    expect(dom.querySelector('script')).toBeNull();
    expect(html).not.toMatch(/javascript:/i);
  });

  it('links ticket keys to the ticket route', () => {
    // Act
    const dom = parse(renderMarkdown('Blocked by PAY-128 and WEB-7.'));
    const links = [...dom.querySelectorAll('a')];

    // Assert
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/tickets/PAY-128',
      '/tickets/WEB-7',
    ]);
    expect(links.every((a) => a.hasAttribute(INTERNAL_LINK_ATTR))).toBe(true);
    expect(links[0].textContent).toBe('PAY-128');
  });

  it('does not link keys inside code, existing links or test-case/session keys', () => {
    // Act
    const dom = parse(
      renderMarkdown(
        '`PAY-1` and [see PAY-2](https://example.com) and WEB-TC-7 and WEB-R-3 and pay-9',
      ),
    );

    // Assert
    expect(dom.querySelectorAll('a.tk-keyref').length).toBe(0);
    expect(dom.querySelector('code')?.textContent).toBe('PAY-1');
  });

  it('opens external links in a new tab without opener', () => {
    // Act
    const anchor = parse(renderMarkdown('[docs](https://example.com)')).querySelector('a');

    // Assert
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  describe('mentions', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const token = `@[Old Name](user:${id})`;
    const ann = { id, displayName: 'Ann Lee', email: 'ann@example.com' };

    it('renders a known user as a chip with avatar initials and the current name', () => {
      // Act
      const dom = parse(renderMarkdown(`Ping ${token}, thanks`, { mentions: [ann] }));
      const chip = dom.querySelector('.tk-mention');

      // Assert
      expect(chip?.getAttribute('data-user-id')).toBe(id);
      expect(chip?.getAttribute('data-testid')).toBe(`mention-${id}`);
      expect(chip?.getAttribute('title')).toBe('ann@example.com');
      expect(chip?.querySelector('.tk-mention-avatar')?.textContent).toBe('AL');
      expect(chip?.querySelector('.tk-mention-avatar')?.className).toMatch(/tk-palette-[0-7]/);
      expect(chip?.textContent).toBe('ALAnn Lee');
      expect(dom.textContent?.trim()).toBe('Ping ALAnn Lee, thanks');
    });

    it('matches ids case-insensitively', () => {
      // Act
      const dom = parse(
        renderMarkdown(`@[Ann](user:${id.toUpperCase()})`, {
          mentions: [{ ...ann, id: id.toUpperCase() }],
        }),
      );

      // Assert
      expect(dom.querySelector('.tk-mention')?.getAttribute('data-user-id')).toBe(id);
    });

    it('renders an unknown or unreadable user as plain text with the stored name', () => {
      // Act
      const dom = parse(renderMarkdown(`Ping ${token}`, { mentions: [] }));

      // Assert
      expect(dom.querySelector('.tk-mention')).toBeNull();
      expect(dom.querySelector('[data-tk-mention]')).toBeNull();
      expect(dom.querySelector('a')).toBeNull();
      expect(dom.textContent?.trim()).toBe('Ping @Old Name');
    });

    it('renders tokens as plain text when no mentions are given (other markdown fields)', () => {
      expect(parse(renderMarkdown(token)).textContent?.trim()).toBe('@Old Name');
    });

    it('leaves tokens in code as code', () => {
      // Act
      const dom = parse(
        renderMarkdown(`\`${token}\`\n\n\`\`\`\n${token}\n\`\`\``, { mentions: [ann] }),
      );

      // Assert
      expect(dom.querySelector('.tk-mention')).toBeNull();
      expect(dom.querySelectorAll('code')[0].textContent).toBe(token);
      expect(dom.querySelector('pre code')?.textContent?.trim()).toBe(token);
    });

    it('escapes names', () => {
      // Arrange
      const evil = '<img src=x onerror=alert(1)>';

      // Act
      const known = parse(
        renderMarkdown(`@[x](user:${id})`, { mentions: [{ ...ann, displayName: evil }] }),
      );
      const unknown = parse(renderMarkdown(`@[<b onclick="x">Eve</b>](user:${id})`));

      // Assert
      expect(known.querySelector('img')).toBeNull();
      expect(known.querySelector('.tk-mention')?.textContent).toContain(evil);
      expect(unknown.querySelector('b')).toBeNull();
      expect(unknown.textContent?.trim()).toBe('@<b onclick="x">Eve</b>');
    });

    it('does not turn ticket keys in a chip into links but keeps them elsewhere', () => {
      // Act
      const dom = parse(
        renderMarkdown(`${token} on PAY-1`, { mentions: [{ ...ann, displayName: 'PAY-2 bot' }] }),
      );

      // Assert
      expect([...dom.querySelectorAll('a.tk-keyref')].map((a) => a.textContent)).toEqual(['PAY-1']);
    });

    it('keeps a malformed token as text and markdown links working', () => {
      // Act
      const dom = parse(renderMarkdown(`@[Ann](user:nope) [docs](https://example.com)`));

      // Assert
      expect(dom.querySelector('.tk-mention')).toBeNull();
      expect(dom.querySelector('a[href="https://example.com"]')?.textContent).toBe('docs');
    });
  });

  describe('app-launching links (agent delegation threat model)', () => {
    const LAUNCH_SCHEME = /^(?:claude-cli|claude|vscode|ticketing-agent):/i;
    // eslint-disable-next-line no-control-regex
    const BROWSER_IGNORED = /[\u0000-\u0020]/g;
    const launching = (dom: HTMLElement) =>
      [...dom.querySelectorAll('*')].flatMap((element) =>
        [...element.attributes]
          .map((attribute) => attribute.value.replace(BROWSER_IGNORED, ''))
          .filter((value) => LAUNCH_SCHEME.test(value)),
      );

    const urls = [
      'claude-cli://open?q=rm%20-rf',
      'claude://code/new?q=x',
      'vscode://file/C:/x',
      'ticketing-agent://run?ticket=TKT-1',
      'CLAUDE-CLI://open?q=x',
      'Claude://code/new?q=x',
      'VsCode://file/x',
      'Ticketing-Agent://run',
    ];
    const syntaxes: [string, (url: string) => string][] = [
      ['inline link', (url) => `[open](${url})`],
      ['inline link with title', (url) => `[open](${url} "Open")`],
      ['angle-bracket destination', (url) => `[open](<${url}>)`],
      ['autolink', (url) => `<${url}>`],
      ['reference-style link', (url) => `[open][1]\n\n[1]: ${url}`],
      ['collapsed reference', (url) => `[open][]\n\n[open]: ${url}`],
      ['image', (url) => `![shot](${url})`],
      ['reference-style image', (url) => `![shot][i]\n\n[i]: ${url}`],
      ['linked image', (url) => `[![shot](/a.png)](${url})`],
      ['raw HTML anchor', (url) => `<a href="${url}">open</a>`],
      ['raw HTML image', (url) => `<img src="${url}">`],
      ['link inside a list and a table', (url) => `- [a](${url})\n\n| x |\n|---|\n| [b](${url}) |`],
    ];

    it.each(
      syntaxes.flatMap(([name, build]) => urls.map((url) => [name, url, build(url)] as const)),
    )('strips %s to %s', (_name, _url, source) => {
      // Act
      const dom = parse(renderMarkdown(source));

      // Assert
      expect(launching(dom)).toEqual([]);
    });

    it.each([
      ['entity-encoded hyphen', '[open](claude&#45;cli://open?q=x)'],
      ['entity-encoded first letter', '[open](&#99;laude-cli://open?q=x)'],
      ['hex entity colon', '[open](claude-cli&#x3A;//open?q=x)'],
      ['named entity colon', '[open](claude-cli&colon;//open?q=x)'],
      ['entity-encoded reference', '[open][r]\n\n[r]: &#118;scode://file/x'],
      ['tab inside the scheme', '[open](<claude\t-cli://open>)'],
      ['leading space in an angle destination', '[open](< claude-cli://open>)'],
      ['newline inside a raw anchor', '<a href="claude-\ncli://x">open</a>'],
      ['NUL before the scheme', '[open](\u0000claude-cli://open)'],
      ['entity-encoded raw anchor', '<a href="&#99;laude://code/new">open</a>'],
    ])('strips an obfuscated scheme: %s', (_name, source) => {
      // Act
      const dom = parse(renderMarkdown(source));

      // Assert
      expect(launching(dom)).toEqual([]);
    });

    it('keeps http(s), mailto, relative and ticket links working next to a stripped one', () => {
      // Act
      const dom = parse(
        renderMarkdown(
          '[a](https://example.com) [b](mailto:x@example.com) [c](/tickets/TKT-1) [d](#top) [e](claude-cli://open) TKT-2',
        ),
      );

      // Assert
      expect([...dom.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toEqual([
        'https://example.com',
        'mailto:x@example.com',
        '/tickets/TKT-1',
        '#top',
        '/tickets/TKT-2',
      ]);
      expect(dom.textContent).toContain('e');
    });

    it('drops other non-web schemes too (allowlist, not blocklist)', () => {
      // Act
      const dom = parse(
        renderMarkdown(
          '[a](tel:123) [b](sms:1) [c](file:///C:/x) [d](ms-word:ofe|u|x) [e](data:text/html,x)',
        ),
      );

      // Assert
      expect(dom.querySelectorAll('a[href]').length).toBe(0);
    });
  });

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });
});
