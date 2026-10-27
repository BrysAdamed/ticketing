const MIRRORED = [
  'box-sizing',
  'width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'tab-size',
];

/// Viewport position of the character at `index` in a textarea (mirror-div technique): a hidden div
/// copies the textarea's box and font, holds the text up to `index`, and a marker span shows where
/// the next character would be drawn. `height` is one line, for placing a popup below it.
export function caretPosition(
  textarea: HTMLTextAreaElement,
  index: number,
): { x: number; y: number; height: number } {
  const doc = textarea.ownerDocument;
  const style = doc.defaultView?.getComputedStyle(textarea);
  const mirror = doc.createElement('div');
  for (const property of MIRRORED)
    mirror.style.setProperty(property, style?.getPropertyValue(property) ?? '');
  Object.assign(mirror.style, {
    position: 'absolute',
    top: '0',
    left: '-9999px',
    visibility: 'hidden',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  });
  mirror.textContent = textarea.value.slice(0, index);
  const marker = doc.createElement('span');
  marker.textContent = textarea.value.slice(index) || '.';
  mirror.appendChild(marker);
  doc.body.appendChild(mirror);
  const box = textarea.getBoundingClientRect();
  const x = box.left + marker.offsetLeft - textarea.scrollLeft;
  const y = box.top + marker.offsetTop - textarea.scrollTop;
  mirror.remove();
  const fontSize = parseFloat(style?.fontSize ?? '') || 14;
  const height = parseFloat(style?.lineHeight ?? '') || Math.round(fontSize * 1.5);
  return { x, y, height };
}
