import { returnFocus } from './return-focus';

describe('returnFocus', () => {
  let root: HTMLElement;

  function render(html: string): void {
    root.innerHTML = html;
  }

  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(() => root.remove());

  it('focuses the target while it is still on the page', () => {
    // Arrange
    render(`
      <button id="help" data-tour-return>Help</button>
      <main id="main-content"><h1 id="heading">Board</h1><button id="trigger">Tour</button></main>
    `);

    // Act
    const focused = returnFocus(document, byId('trigger'));

    // Assert
    expect(focused).toBe(byId('trigger'));
    expect(document.activeElement).toBe(byId('trigger'));
  });

  it('falls back to the main heading when the target was removed', () => {
    // Arrange
    render(`
      <button id="help" data-tour-return>Help</button>
      <main id="main-content"><h1 id="heading">Board</h1><button id="trigger">Tour</button></main>
    `);
    const trigger = byId('trigger');
    trigger.remove();

    // Act
    returnFocus(document, trigger);

    // Assert
    const heading = byId('heading');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps a heading tabindex that is already set', () => {
    // Arrange
    render(`<main id="main-content"><h1 id="heading" tabindex="0">Board</h1></main>`);

    // Act
    returnFocus(document, null);

    // Assert
    expect(byId('heading').getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(byId('heading'));
  });

  it('falls back to the Help trigger when the view has no main heading', () => {
    // Arrange
    render(`
      <button id="help" data-tour-return>Help</button>
      <main id="main-content"><h2>Not the main heading</h2></main>
    `);

    // Act
    const focused = returnFocus(document, null);

    // Assert
    expect(focused).toBe(byId('help'));
    expect(document.activeElement).toBe(byId('help'));
  });

  it.each([
    ['the body', () => document.body],
    ['a disabled button', () => byId('disabled')],
    ['an element inside a hidden subtree', () => byId('inside-hidden')],
  ])('treats %s as gone', (_, target) => {
    // Arrange
    render(`
      <button id="help" data-tour-return>Help</button>
      <button id="disabled" disabled>Off</button>
      <div hidden><button id="inside-hidden">Hidden</button></div>
    `);

    // Act
    returnFocus(document, target());

    // Assert
    expect(document.activeElement).toBe(byId('help'));
  });

  it('skips a main heading that is hidden', () => {
    // Arrange
    render(`
      <button id="help" data-tour-return>Help</button>
      <main id="main-content"><div aria-hidden="true"><h1>Board</h1></div></main>
    `);

    // Act
    returnFocus(document, null);

    // Assert
    expect(document.activeElement).toBe(byId('help'));
  });

  it('returns null and leaves focus alone when nothing fits', () => {
    // Arrange
    render(`<button id="other">Other</button>`);
    byId('other').focus();

    // Act
    const focused = returnFocus(document, null);

    // Assert
    expect(focused).toBeNull();
    expect(document.activeElement).toBe(byId('other'));
  });
});
