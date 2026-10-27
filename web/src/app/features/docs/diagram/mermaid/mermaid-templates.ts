/// Starter diagrams for the supported Mermaid types: the editor's template menu and empty state,
/// and the inline ```mermaid block of the page editor.
export interface MermaidTemplate {
  readonly id: string;
  readonly label: string;
  readonly source: string;
}

export const MERMAID_TEMPLATES: readonly MermaidTemplate[] = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    source: [
      'flowchart LR',
      '  user([User]) --> web[Web app]',
      '  web --> api[API]',
      '  api --> db[(Database)]',
      '  api -- events --> queue[[Queue]]',
    ].join('\n'),
  },
  {
    id: 'sequence',
    label: 'Sequence',
    source: [
      'sequenceDiagram',
      '  actor User',
      '  participant Web',
      '  participant API',
      '  User->>Web: Submit form',
      '  Web->>API: POST /orders',
      '  API-->>Web: 201 Created',
      '  Web-->>User: Confirmation',
    ].join('\n'),
  },
  {
    id: 'class',
    label: 'Class',
    source: [
      'classDiagram',
      '  class Order {',
      '    +Guid Id',
      '    +decimal Total',
      '    +Submit()',
      '  }',
      '  class OrderLine {',
      '    +int Quantity',
      '  }',
      '  Order "1" *-- "many" OrderLine',
    ].join('\n'),
  },
  {
    id: 'state',
    label: 'State',
    source: [
      'stateDiagram-v2',
      '  [*] --> Draft',
      '  Draft --> Submitted: submit',
      '  Submitted --> Approved: approve',
      '  Submitted --> Draft: reject',
      '  Approved --> [*]',
    ].join('\n'),
  },
  {
    id: 'er',
    label: 'Entity relationship',
    source: [
      'erDiagram',
      '  CUSTOMER ||--o{ ORDER : places',
      '  ORDER ||--|{ ORDER_LINE : contains',
      '  PRODUCT ||--o{ ORDER_LINE : "ordered in"',
    ].join('\n'),
  },
  {
    id: 'gantt',
    label: 'Gantt',
    source: [
      'gantt',
      '  title Release plan',
      '  dateFormat YYYY-MM-DD',
      '  section Build',
      '    Backend   :a1, 2026-11-02, 10d',
      '    Frontend  :after a1, 8d',
      '  section Ship',
      '    Testing   :2026-11-20, 5d',
    ].join('\n'),
  },
  {
    id: 'mindmap',
    label: 'Mind map',
    source: [
      'mindmap',
      '  root((Release))',
      '    Scope',
      '      Features',
      '      Bugs',
      '    Quality',
      '      Tests',
      '      Review',
    ].join('\n'),
  },
];
