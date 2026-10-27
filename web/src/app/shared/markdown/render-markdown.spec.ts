import { headingSlug, INTERNAL_LINK_ATTR, renderMarkdown } from './render-markdown';

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

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });

  describe('GFM alerts', () => {
    it('turns > [!KIND] blockquotes into callouts with a title', () => {
      // Act
      const dom = parse(
        renderMarkdown('> [!WARNING]\n> Rotate the key\n> before Friday.\n\n> [!tip] Inline tip'),
      );
      const callouts = [...dom.querySelectorAll('.tk-md-callout')];

      // Assert
      expect(dom.querySelector('blockquote')).toBeNull();
      expect(callouts.map((c) => c.className)).toEqual([
        'tk-md-callout tk-md-callout-warning',
        'tk-md-callout tk-md-callout-tip',
      ]);
      expect(callouts[0].querySelector('.tk-md-callout-title')?.textContent).toBe('Warning');
      expect(callouts[0].textContent).not.toContain('[!WARNING]');
      expect(callouts[0].querySelector('p:not(.tk-md-callout-title)')?.textContent).toContain(
        'Rotate the key',
      );
      expect(callouts[1].textContent).toContain('Inline tip');
    });

    it('leaves ordinary quotes and unknown markers alone', () => {
      // Act
      const dom = parse(renderMarkdown('> [!DANGER] no\n\n> plain quote'));

      // Assert
      expect(dom.querySelectorAll('blockquote').length).toBe(2);
      expect(dom.querySelector('.tk-md-callout')).toBeNull();
    });
  });

  describe('heading anchors', () => {
    it('gives headings stable, de-duplicated ids and an anchor link only when asked', () => {
      // Arrange
      const source = '# Payment flow\n\n## Overview\n\n### Overview\n\n## Ünïcode & *stuff*!';

      // Act
      const dom = parse(renderMarkdown(source, { headingAnchors: true }));
      const plain = parse(renderMarkdown(source));

      // Assert
      expect([...dom.querySelectorAll('h1, h2, h3')].map((h) => h.id)).toEqual([
        'payment-flow',
        'overview',
        'overview-2',
        'ünïcode--stuff',
      ]);
      expect(dom.querySelector('h2 a.tk-anchor')?.getAttribute('href')).toBe('#overview');
      expect(dom.querySelector('h2')?.textContent).toBe('Overview');
      expect(plain.querySelector('[id]')).toBeNull();
      expect(plain.querySelector('.tk-anchor')).toBeNull();
    });

    it('falls back to "section" for a heading without letters', () => {
      expect(headingSlug('!!!')).toBe('section');
      expect(headingSlug('  Use Postgres 18 ')).toBe('use-postgres-18');
    });
  });
});
