using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <summary>An immutable full snapshot of a page or diagram at one publish (no deltas; PostgreSQL compresses the content).</summary>
public sealed class DocVersion
{
    private DocVersion()
    {
        Title = null!;
        Content = null!;
    }

    public Guid Id { get; private set; }

    public Guid NodeId { get; private set; }

    public int Number { get; private set; }

    public string Title { get; private set; }

    public string Content { get; private set; }

    public string? ChangeNote { get; private set; }

    public Guid AuthorId { get; private set; }

    public WriteChannel Channel { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Set when the version was created by restoring an older one.</summary>
    public int? RestoredFrom { get; private set; }

    /// <summary>Lines added compared with the previous version; null for Canvas diagrams and versions published before TKT-48.</summary>
    public int? LinesAdded { get; private set; }

    /// <summary>Lines removed compared with the previous version; null like <see cref="LinesAdded"/>.</summary>
    public int? LinesRemoved { get; private set; }

    /// <summary>Snapshots <paramref name="node"/>'s current version, title and content; <paramref name="previousContent"/> is the content of the version before it (null for version 1).</summary>
    public static DocVersion Snapshot(
        DocNode node, string? previousContent, string? changeNote, Guid authorId, WriteChannel channel, DateTimeOffset now, int? restoredFrom = null)
    {
        node.EnsureHasContent();
        DocLineChanges? changes = node.DiagramFormat == DiagramFormat.Canvas ? null : DocLineDiff.Count(previousContent, node.Content);
        return new DocVersion
        {
            Id = EntityId.New(),
            NodeId = node.Id,
            Number = node.CurrentVersion,
            Title = node.Title,
            Content = node.Content ?? string.Empty,
            ChangeNote = Text.Optional(changeNote, "changeNote", DocNode.ChangeNoteMaxLength),
            AuthorId = authorId,
            Channel = channel,
            CreatedAt = now,
            RestoredFrom = restoredFrom,
            LinesAdded = changes?.Added,
            LinesRemoved = changes?.Removed,
        };
    }
}
