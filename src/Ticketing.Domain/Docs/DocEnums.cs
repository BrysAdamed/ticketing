namespace Ticketing.Domain.Docs;

public enum DocKind
{
    Folder = 1,
    Page = 2,
    Diagram = 3,
}

public enum DiagramFormat
{
    Mermaid = 1,
    Canvas = 2,
}

public enum DocReferenceTarget
{
    Ticket = 1,
    Doc = 2,
}
