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

  it('returns an empty string for empty input', () => {
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('')).toBe('');
  });
});
