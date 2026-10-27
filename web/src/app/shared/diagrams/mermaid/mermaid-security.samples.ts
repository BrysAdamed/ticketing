/// Hostile Mermaid sources that must render inert (no script, handler, javascript: URL or HTML
/// label in the output). Shared by the unit test and the browser checks of TKT-11 / TKT-17.
export const MERMAID_SECURITY_SAMPLES: Readonly<Record<string, string>> = {
  clickCallback: ['flowchart LR', '  A[Click me] --> B[Target]', '  click A call alert(1)'].join(
    '\n',
  ),
  javascriptLink: [
    'flowchart LR',
    '  A[Link] --> B[Other]',
    '  click A href "javascript:alert(document.domain)"',
    '  click B "javascript:alert(2)" "tooltip"',
  ].join('\n'),
  htmlLabel: [
    'flowchart LR',
    '  A["<img src=x onerror=alert(1)>"] --> B["<script>alert(2)</script>"]',
    '  B --> C["<a href=javascript:alert(3)>link</a>"]',
  ].join('\n'),
  initDirective: [
    '%%{init: {"securityLevel": "loose", "htmlLabels": true, "flowchart": {"htmlLabels": true}}}%%',
    'flowchart LR',
    '  A["<b onmouseover=alert(1)>bold</b>"] --> B',
    '  click A call alert(1)',
  ].join('\n'),
  frontMatter: [
    '---',
    'config:',
    '  securityLevel: loose',
    '  htmlLabels: true',
    '---',
    'flowchart LR',
    '  A["<img src=x onerror=alert(1)>"] --> B',
  ].join('\n'),
  sequenceLink: [
    'sequenceDiagram',
    '  participant Alice',
    '  link Alice: Evil @ javascript:alert(1)',
    '  Alice->>Bob: Hi <img src=x onerror=alert(1)>',
  ].join('\n'),
};

const ACTIVE_ELEMENTS = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'img', 'image'];

/// Lists what would be active in a rendered SVG: active elements, event-handler attributes and
/// links or references to a non-http(s) URL. Text that merely looks like HTML is fine.
export function unsafeSvgFindings(svg: string): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const findings: string[] = [];
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const name = element.localName.toLowerCase();
    if (ACTIVE_ELEMENTS.includes(name)) findings.push(`<${name}>`);
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith('on')) findings.push(`${name}[${attributeName}]`);
      const isLink = attributeName === 'href' || attributeName.endsWith(':href');
      if (isLink && !/^(https?:|#|\/)/i.test(attribute.value.trim())) {
        findings.push(`${name}[${attributeName}=${attribute.value}]`);
      }
    }
  }
  return findings;
}
