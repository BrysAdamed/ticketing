using Ticketing.Domain.Common;

namespace Ticketing.Domain.Comments;

public sealed class Comment
{
    public const int BodyMaxLength = 20_000;

    private Comment()
    {
        Body = null!;
    }

    public Guid Id { get; private set; }

    /// <summary>The ticket the comment is on; null for a doc comment (exactly one of this and <see cref="DocNodeId"/> is set).</summary>
    public Guid? TicketId { get; private set; }

    public Guid? DocNodeId { get; private set; }

    public Guid AuthorId { get; private set; }

    /// <summary>Empty once the comment is deleted (the UI shows a placeholder).</summary>
    public string Body { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? EditedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public Guid? DeletedById { get; private set; }

    public uint RowVersion { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public static Comment Create(Guid ticketId, Guid authorId, string body, DateTimeOffset now) => New(ticketId, null, authorId, body, now);

    public static Comment CreateForDoc(Guid docNodeId, Guid authorId, string body, DateTimeOffset now) => New(null, docNodeId, authorId, body, now);

    private static Comment New(Guid? ticketId, Guid? docNodeId, Guid authorId, string body, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        TicketId = ticketId,
        DocNodeId = docNodeId,
        AuthorId = authorId,
        Body = Text.Required(body, "body", BodyMaxLength),
        CreatedAt = now,
    };

    /// <summary>Replaces the body and returns the previous one, which goes to the activity log.</summary>
    public string Edit(string body, DateTimeOffset now)
    {
        EnsureNotDeleted();
        var previous = Body;
        Body = Text.Required(body, "body", BodyMaxLength);
        EditedAt = now;
        return previous;
    }

    /// <summary>Only the author edits a comment (spec 6.9).</summary>
    public string EditBy(Guid actorId, string body, DateTimeOffset now)
    {
        EnsureEditableBy(actorId);
        return Edit(body, now);
    }

    public void EnsureEditableBy(Guid actorId)
    {
        if (actorId != AuthorId)
            throw DomainException.Forbidden(CommentErrors.NotAuthor, "Only the author can edit a comment.");
    }

    /// <summary>The author deletes their own comment; project Owners delete any comment (spec 6.9).</summary>
    public void DeleteBy(Guid actorId, bool actorIsProjectOwner, DateTimeOffset now)
    {
        if (actorId != AuthorId && !actorIsProjectOwner)
            throw DomainException.Forbidden(CommentErrors.NotAuthor, "Only the author or a project owner can delete this comment.");
        Delete(actorId, now);
    }

    public void Delete(Guid actorId, DateTimeOffset now)
    {
        if (IsDeleted)
            return;
        Body = string.Empty;
        DeletedAt = now;
        DeletedById = actorId;
    }

    private void EnsureNotDeleted()
    {
        if (IsDeleted)
            throw DomainException.Conflict(CommentErrors.Deleted, "The comment was deleted.");
    }
}
