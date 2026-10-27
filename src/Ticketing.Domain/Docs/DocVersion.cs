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

    /// <summary>
    /// Canvas only: the light SVG picture of this version (<see cref="CanvasSnapshot"/>). Null until a client exported it, for
    /// example for versions written over MCP; it is filled once and never replaced.
    /// </summary>
    public string? SnapshotSvg { get; private set; }

    /// <summary>Snapshots <paramref name="node"/>'s current version, title and content (and the Canvas picture, if any).</summary>
    public static DocVersion Snapshot(
        DocNode node, string? changeNote, Guid authorId, WriteChannel channel, DateTimeOffset now, int? restoredFrom = null, string? snapshotSvg = null)
    {
        node.EnsureHasContent();
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
            SnapshotSvg = snapshotSvg,
        };
    }
}
