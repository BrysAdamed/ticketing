using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Collaboration;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Comments;

public static class CommentQueries
{
    public static async Task<IReadOnlyList<CommentDto>> LatestAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant grant, Guid ticketId, int count, CancellationToken cancellationToken)
    {
        var rows = await Rows(db, db.Comments.Where(c => c.TicketId == ticketId))
            .OrderByDescending(r => r.Comment.CreatedAt).ThenByDescending(r => r.Comment.Id)
            .Take(count)
            .ToListAsync(cancellationToken);
        rows.Reverse();
        var mentioned = await MentionedAsync(db, grant, rows, cancellationToken);
        return [.. rows.Select(r => ToDto(r, currentUser, grant, mentioned))];
    }

    public static async Task<CursorPage<CommentDto>> PageAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant grant, Guid ticketId, PageRequest page, CancellationToken cancellationToken)
    {
        var after = Cursor.Decode<CommentCursor>(page.Cursor);
        var comments = db.Comments.Where(c => c.TicketId == ticketId);
        if (after is not null)
            comments = comments.Where(c => c.CreatedAt > after.At || (c.CreatedAt == after.At && c.Id.CompareTo(after.Id) > 0));

        var rows = await Rows(db, comments)
            .OrderBy(r => r.Comment.CreatedAt).ThenBy(r => r.Comment.Id)
            .ToCursorPageAsync(page, r => new CommentCursor(r.Comment.CreatedAt, r.Comment.Id), cancellationToken);
        var mentioned = await MentionedAsync(db, grant, rows.Items, cancellationToken);
        return rows.Map(r => ToDto(r, currentUser, grant, mentioned));
    }

    public static async Task<CommentDto> OneAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant grant, Guid commentId, CancellationToken cancellationToken)
    {
        var row = await Rows(db, db.Comments.Where(c => c.Id == commentId)).SingleAsync(cancellationToken);
        var mentioned = await MentionedAsync(db, grant, [row], cancellationToken);
        return ToDto(row, currentUser, grant, mentioned);
    }

    private static IQueryable<Row> Rows(ITicketingDbContext db, IQueryable<Comment> comments) =>
        from c in comments.AsNoTracking()
        join u in db.Users on c.AuthorId equals u.Id
        select new Row { Comment = c, Author = new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive) };

    private static Task<IReadOnlyDictionary<Guid, UserRefDto>> MentionedAsync(
        ITicketingDbContext db, ProjectAccessGrant grant, IEnumerable<Row> rows, CancellationToken cancellationToken) =>
        MentionedUsers.LoadAsync(db, grant.ProjectId, rows.Select(r => r.Comment.Body), cancellationToken);

    private static CommentDto ToDto(Row row, ICurrentUser currentUser, ProjectAccessGrant grant, IReadOnlyDictionary<Guid, UserRefDto> mentioned)
    {
        var c = row.Comment;
        var canWrite = grant.CanWrite && !grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly && !c.IsDeleted;
        var isAuthor = c.AuthorId == currentUser.Id;
        return new CommentDto(
            c.Id, c.TicketId!.Value, row.Author, c.Body, c.CreatedAt, c.EditedAt, c.IsDeleted, c.DeletedAt,
            canWrite && isAuthor, canWrite && (isAuthor || grant.IsOwner), MentionedUsers.In(c.Body, mentioned));
    }

    private sealed class Row
    {
        public required Comment Comment { get; init; }

        public required UserRefDto Author { get; init; }
    }

    private sealed record CommentCursor(DateTimeOffset At, Guid Id);
}

internal static class CommentLookup
{
    /// <summary>Loads a tracked comment whose ticket the caller can write to; comments on unreadable tickets are not found.</summary>
    public static async Task<(Comment Comment, TicketTarget Ticket)> WriteAsync(
        ITicketingDbContext db, IProjectAccess access, Guid commentId, CancellationToken cancellationToken)
    {
        var comment = await db.Comments.SingleOrDefaultAsync(c => c.Id == commentId && c.TicketId != null, cancellationToken) ?? throw NotFound();
        var projectId = await db.Tickets.Where(t => t.Id == comment.TicketId).Select(t => t.ProjectId).SingleAsync(cancellationToken);
        if (await access.FindAsync(projectId, cancellationToken) is null)
            throw NotFound();
        var target = await TicketLookup.WriteAsync(db, access, comment.TicketId!.Value.ToString(), cancellationToken);
        return (comment, target);
    }

    private static AppException NotFound() => AppException.NotFound(CommentErrors.NotFound, "The comment was not found.");
}
