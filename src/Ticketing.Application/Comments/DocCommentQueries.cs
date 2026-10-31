using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Collaboration;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Comments;

/// <summary>A comment in the footer thread of a page or diagram (docs refinement D12). Deleted comments have an empty body;
/// <see cref="Mentions"/> are the mentioned users who are active and can read the project (D-96, D-162).</summary>
public sealed record DocCommentDto(
    Guid Id,
    string DocKey,
    UserRefDto Author,
    string Body,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt,
    bool Deleted,
    DateTimeOffset? DeletedAt,
    bool CanEdit,
    bool CanDelete,
    IReadOnlyList<UserRefDto> Mentions);

public static class DocCommentQueries
{
    public static async Task<CursorPage<DocCommentDto>> PageAsync(
        ITicketingDbContext db, ICurrentUser currentUser, DocTarget doc, PageRequest page, CancellationToken cancellationToken)
    {
        var after = Cursor.Decode<CommentCursor>(page.Cursor);
        var docNodeId = doc.Id;
        var comments = db.Comments.Where(c => c.DocNodeId == docNodeId);
        if (after is not null)
            comments = comments.Where(c => c.CreatedAt > after.At || (c.CreatedAt == after.At && c.Id.CompareTo(after.Id) > 0));

        var rows = await Rows(db, comments)
            .OrderBy(r => r.Comment.CreatedAt).ThenBy(r => r.Comment.Id)
            .ToCursorPageAsync(page, r => new CommentCursor(r.Comment.CreatedAt, r.Comment.Id), cancellationToken);
        var mentioned = await MentionedUsers.LoadAsync(db, doc.ProjectId, rows.Items.Select(r => r.Comment.Body), cancellationToken);
        return rows.Map(r => ToDto(r, currentUser, doc, mentioned));
    }

    public static async Task<DocCommentDto> OneAsync(
        ITicketingDbContext db, ICurrentUser currentUser, DocTarget doc, Guid commentId, CancellationToken cancellationToken)
    {
        var row = await Rows(db, db.Comments.Where(c => c.Id == commentId)).SingleAsync(cancellationToken);
        var mentioned = await MentionedUsers.LoadAsync(db, doc.ProjectId, [row.Comment.Body], cancellationToken);
        return ToDto(row, currentUser, doc, mentioned);
    }

    /// <summary>Only pages and diagrams have a comment thread.</summary>
    public static void EnsureCommentable(DocTarget doc)
    {
        if (doc.Kind == DocKind.Folder)
            throw AppException.Conflict(DocErrors.KindUnsupported, $"{doc.Key} is a folder; only pages and diagrams have comments.", "Pass a page or diagram key.");
    }

    private static IQueryable<Row> Rows(ITicketingDbContext db, IQueryable<Comment> comments) =>
        from c in comments.AsNoTracking()
        join u in db.Users on c.AuthorId equals u.Id
        select new Row { Comment = c, Author = new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive) };

    private static DocCommentDto ToDto(Row row, ICurrentUser currentUser, DocTarget doc, IReadOnlyDictionary<Guid, UserRefDto> mentioned)
    {
        var c = row.Comment;
        var canWrite = DocQueries.CanWrite(doc.Grant, currentUser) && !c.IsDeleted;
        var isAuthor = c.AuthorId == currentUser.Id;
        return new DocCommentDto(
            c.Id, doc.Key, row.Author, c.Body, c.CreatedAt, c.EditedAt, c.IsDeleted, c.DeletedAt, canWrite && isAuthor, canWrite && (isAuthor || doc.Grant.IsOwner),
            MentionedUsers.In(c.Body, mentioned));
    }

    private sealed class Row
    {
        public required Comment Comment { get; init; }

        public required UserRefDto Author { get; init; }
    }

    private sealed record CommentCursor(DateTimeOffset At, Guid Id);
}

internal static class DocCommentLookup
{
    /// <summary>
    /// Loads a tracked doc comment whose doc the caller can write to. Comments of unreadable projects and ticket comments are
    /// not found; comments of a deleted doc answer <c>doc.deleted</c>.
    /// </summary>
    public static async Task<(Comment Comment, DocTarget Doc)> WriteAsync(
        ITicketingDbContext db, IProjectAccess access, Guid commentId, CancellationToken cancellationToken)
    {
        var comment = await db.Comments.SingleOrDefaultAsync(c => c.Id == commentId && c.DocNodeId != null, cancellationToken) ?? throw NotFound();
        var projectId = await db.DocNodes.Where(n => n.Id == comment.DocNodeId).Select(n => n.ProjectId).SingleAsync(cancellationToken);
        if (await access.FindAsync(projectId, cancellationToken) is null)
            throw NotFound();
        var doc = await DocLookup.WriteAsync(db, access, comment.DocNodeId!.Value.ToString(), cancellationToken);
        return (comment, doc);
    }

    private static AppException NotFound() => AppException.NotFound(CommentErrors.NotFound, "The comment was not found.");
}
