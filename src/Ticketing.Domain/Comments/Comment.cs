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

    public Guid TicketId { get; private set; }

    public Guid AuthorId { get; private set; }

    /// <summary>Empty once the comment is deleted (the UI shows a placeholder).</summary>
    public string Body { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? EditedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    public Guid? DeletedById { get; private set; }

    public uint RowVersion { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    public static Comment Create(Guid ticketId, Guid authorId, string body, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        TicketId = ticketId,
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
            throw DomainException.Conflict("comment.deleted", "The comment was deleted.");
    }
}
