using Ticketing.Domain.Common;
using Ticketing.Domain.Ordering;

namespace Ticketing.Domain.Docs;

/// <summary>
/// A node of a project's docs tree (folder, page or diagram). Pages and diagrams carry a copy of their latest published
/// content; every publish also writes an immutable <see cref="DocVersion"/>. Folders have no content and no versions.
/// </summary>
public sealed class DocNode
{
    public const int TitleMaxLength = 200;
    public const int ChangeNoteMaxLength = 200;
    public const int PageContentMaxLength = 100_000;
    public const int MermaidSourceMaxLength = 20_000;
    public const int CanvasSourceMaxLength = 2_000_000;
    public const int RestoreWindowMinutes = 10;

    /// <summary>How long after deletion the deleter can undo it; Owners can restore from the trash at any time.</summary>
    public static readonly TimeSpan RestoreWindow = TimeSpan.FromMinutes(RestoreWindowMinutes);

    private DocNode()
    {
        Title = null!;
        Rank = null!;
    }

    public Guid Id { get; private set; }

    public Guid ProjectId { get; private set; }

    public int Number { get; private set; }

    public DocKind Kind { get; private set; }

    public DiagramFormat? DiagramFormat { get; private set; }

    /// <summary>Null means the project root; otherwise a non-deleted folder of the same project.</summary>
    public Guid? ParentId { get; private set; }

    public string Rank { get; private set; }

    public string Title { get; private set; }

    /// <summary>The latest published content (markdown or diagram source); null for folders.</summary>
    public string? Content { get; private set; }

    /// <summary>Searchable text extracted from a Canvas source (labels and relations); null for other kinds until a Canvas publish sets it.</summary>
    public string? Outline { get; private set; }

    /// <summary>0 for folders, otherwise the number of the latest version (1..n).</summary>
    public int CurrentVersion { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public Guid UpdatedById { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public Guid? DeletedById { get; private set; }

    /// <summary>Groups a subtree deleted together: the id of the node the delete was called on.</summary>
    public Guid? DeletedRootId { get; private set; }

    public uint RowVersion { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public bool IsFolder => Kind == DocKind.Folder;

    public static DocNode CreateFolder(Guid projectId, int number, Guid? parentId, string rank, string title, Guid actorId, DateTimeOffset now) =>
        New(projectId, number, DocKind.Folder, null, parentId, rank, title, actorId, now);

    /// <summary>Creates a page or diagram at version 1 with <paramref name="content"/> (possibly empty).</summary>
    public static DocNode CreateDocument(
        Guid projectId, int number, DocKind kind, DiagramFormat? format, Guid? parentId, string rank, string title, string? content, Guid actorId,
        DateTimeOffset now)
    {
        if (kind == DocKind.Folder)
            throw new ArgumentOutOfRangeException(nameof(kind), "Folders have no content; use CreateFolder.");
        if ((kind == DocKind.Diagram) != (format is not null))
            throw DomainException.Invalid(
                "diagramFormat", DocErrors.FormatInvalid, "diagramFormat is required for diagrams (Mermaid or Canvas) and not allowed otherwise.");

        var node = New(projectId, number, kind, format, parentId, rank, title, actorId, now);
        node.Content = DocContent.Normalize(content, kind, format);
        node.CurrentVersion = 1;
        return node;
    }

    public static int ContentMaxLength(DocKind kind, DiagramFormat? format) => (kind, format) switch
    {
        (DocKind.Page, _) => PageContentMaxLength,
        (DocKind.Diagram, Docs.DiagramFormat.Mermaid) => MermaidSourceMaxLength,
        (DocKind.Diagram, Docs.DiagramFormat.Canvas) => CanvasSourceMaxLength,
        _ => 0,
    };

    public string KeyIn(string projectKey) => HumanKeys.Doc(projectKey, Number);

    /// <summary>Changes the title; returns false when it is unchanged. Sibling uniqueness is checked by the caller.</summary>
    public bool Rename(string title, Guid actorId, DateTimeOffset now)
    {
        var normalized = DocTitles.Normalize(title);
        if (string.Equals(normalized, Title, StringComparison.Ordinal))
            return false;
        Title = normalized;
        Touch(actorId, now);
        return true;
    }

    /// <summary>Replaces the content and advances <see cref="CurrentVersion"/>; the caller snapshots it as a <see cref="DocVersion"/>.</summary>
    public void Publish(string? content, Guid actorId, DateTimeOffset now)
    {
        EnsureHasContent();
        Content = DocContent.Normalize(content, Kind, DiagramFormat);
        CurrentVersion++;
        Touch(actorId, now);
    }

    /// <summary>Sets the Canvas outline extracted from the source (labels and relations), used by search and MCP.</summary>
    public void SetOutline(string? outline) => Outline = outline;

    public void MoveTo(Guid? parentId, string rank, Guid actorId, DateTimeOffset now)
    {
        if (parentId == Id)
            throw DomainException.Conflict(DocErrors.TreeCycle, "A folder cannot be moved into itself.");
        var parentChanged = parentId != ParentId;
        ParentId = parentId;
        Rank = Ranks.Validate(rank);
        if (parentChanged)
            Touch(actorId, now);
    }

    public void Rerank(string rank) => Rank = Ranks.Validate(rank);

    public void Delete(Guid actorId, DateTimeOffset now, Guid rootId)
    {
        if (IsDeleted)
            return;
        DeletedAt = now;
        DeletedById = actorId;
        DeletedRootId = rootId;
    }

    /// <summary>Brings the root of a deleted group back under <paramref name="parentId"/> with a possibly changed title.</summary>
    public void Restore(Guid? parentId, string rank, string title)
    {
        if (!IsDeleted)
            throw DomainException.Conflict(DocErrors.NotDeleted, "The doc is not deleted.");
        ParentId = parentId;
        Rank = Ranks.Validate(rank);
        Title = DocTitles.Normalize(title);
        DeletedAt = null;
        DeletedById = null;
        DeletedRootId = null;
    }

    /// <summary>True while <paramref name="now"/> is inside the undo window of the deleter.</summary>
    public bool CanBeUndoneAt(DateTimeOffset now) => DeletedAt is { } deletedAt && now - deletedAt <= RestoreWindow;

    public void EnsureHasContent()
    {
        if (IsFolder)
            throw DomainException.Conflict(DocErrors.KindUnsupported, "Folders have no content.", "Pass a page or diagram key.");
    }

    private void Touch(Guid actorId, DateTimeOffset now)
    {
        UpdatedAt = now;
        UpdatedById = actorId;
    }

    private static DocNode New(
        Guid projectId, int number, DocKind kind, DiagramFormat? format, Guid? parentId, string rank, string title, Guid actorId, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        ProjectId = projectId,
        Number = number,
        Kind = kind,
        DiagramFormat = format,
        ParentId = parentId,
        Rank = Ranks.Validate(rank),
        Title = DocTitles.Normalize(title),
        CreatedAt = now,
        CreatedById = actorId,
        UpdatedAt = now,
        UpdatedById = actorId,
    };
}
