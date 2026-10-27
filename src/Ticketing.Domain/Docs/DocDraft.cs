using Ticketing.Domain.Common;

namespace Ticketing.Domain.Docs;

/// <summary>
/// A user's private, unpublished edit of a page or diagram (one per user and doc). Only its owner reads it; others see
/// presence. Deleted on publish or discard, kept when the doc is deleted so a restore brings it back.
/// </summary>
public sealed class DocDraft
{
    private DocDraft()
    {
        Title = null!;
        Content = null!;
    }

    public Guid NodeId { get; private set; }

    public Guid UserId { get; private set; }

    /// <summary>The published version the edit started from.</summary>
    public int BaseVersion { get; private set; }

    /// <summary>May be empty while the title is being typed; publishing requires a title.</summary>
    public string Title { get; private set; }

    public string Content { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static DocDraft Create(DocNode node, Guid userId, int baseVersion, string? title, string? content, DateTimeOffset now)
    {
        var draft = new DocDraft { NodeId = node.Id, UserId = userId, CreatedAt = now };
        draft.Update(node, baseVersion, title, content, now);
        return draft;
    }

    public void Update(DocNode node, int baseVersion, string? title, string? content, DateTimeOffset now)
    {
        if (baseVersion < 1 || baseVersion > node.CurrentVersion)
            throw DomainException.Invalid(
                "baseVersion", DocErrors.BaseVersionInvalid, $"baseVersion must be between 1 and the current version {node.CurrentVersion}.");
        var trimmed = title?.Trim() ?? string.Empty;
        if (trimmed.Length > 0)
            trimmed = DocTitles.Normalize(trimmed);
        BaseVersion = baseVersion;
        Title = trimmed;
        Content = DocContent.Normalize(content, node.Kind, node.DiagramFormat);
        UpdatedAt = now;
    }
}
