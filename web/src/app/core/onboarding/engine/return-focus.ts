const MAIN_HEADING = '#main-content h1';
const HELP_TRIGGER = '[data-tour-return]';

/// Gives focus back when a tour ends: to `target` while it is still on the page, else to the
/// view's main heading, else to the Help trigger (TKT-88). Returns the element focused, or null.
export function returnFocus(document: Document, target: HTMLElement | null): HTMLElement | null {
  const element = usable(document, target) ? target : fallback(document);
  if (!element) return null;
  if (element.matches('h1') && !element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1');
  }
  element.focus();
  return element;
}

function usable(document: Document, target: HTMLElement | null): target is HTMLElement {
  return (
    !!target &&
    target.isConnected &&
    target !== document.body &&
    !target.matches(':disabled') &&
    !isHidden(target)
  );
}

function fallback(document: Document): HTMLElement | null {
  for (const selector of [MAIN_HEADING, HELP_TRIGGER]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element && !isHidden(element)) return element;
  }
  return null;
}

function isHidden(element: HTMLElement): boolean {
  return element.closest('[hidden], [inert], [aria-hidden="true"]') !== null;
}
