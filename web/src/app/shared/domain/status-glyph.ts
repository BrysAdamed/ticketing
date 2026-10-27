import { TicketStatus } from './enums';

const SVG_NS = 'http://www.w3.org/2000/svg';

/// The filled pie of the status progress ring (design-system §8), on a 14×14 view box.
export const STATUS_PIES: Partial<Record<TicketStatus, string>> = {
  InProgress: 'M7 7 7 3.5A3.5 3.5 0 0 1 10.5 7Z',
  Review: 'M7 7 7 3.5A3.5 3.5 0 0 1 7 10.5Z',
  ReadyForTesting: 'M7 7 7 3.5A3.5 3.5 0 1 1 4.525 9.475Z',
  Testing: 'M7 7 7 3.5A3.5 3.5 0 1 1 3.5 7Z',
  ReadyForDeploy: 'M7 7 7 3.5A3.5 3.5 0 1 1 4.525 4.525Z',
};

/// The status ring as a plain SVG element in `currentColor` (no Angular), for HTML built outside
/// components such as rendered markdown; `tk-status-icon` draws the same shapes.
export function statusGlyph(doc: Document, status: TicketStatus, size = 14): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const add = (name: string, attributes: Record<string, string>) => {
    const element = doc.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    svg.appendChild(element);
  };
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' };
  if (status === 'Done') {
    add('circle', { cx: '7', cy: '7', r: '6.5', fill: 'currentColor' });
    add('path', {
      d: 'M4.4 7.2 6.2 9l3.4-3.6',
      fill: 'none',
      stroke: '#fff',
      'stroke-width': '1.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
  } else if (status === 'OnHold') {
    add('circle', { cx: '7', cy: '7', r: '5.75', ...stroke });
    add('path', { d: 'M5.6 4.9v4.2M8.4 4.9v4.2', ...stroke, 'stroke-linecap': 'round' });
  } else {
    add('circle', { cx: '7', cy: '7', r: '5.75', ...stroke });
    const pie = STATUS_PIES[status];
    if (pie) add('path', { d: pie, fill: 'currentColor' });
  }
  return svg;
}
