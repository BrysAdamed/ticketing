using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Attachments;

/// <param name="Url">Download path; images render inline, other types download (spec 4.8). Markdown embeds it as <c>![name](url)</c>.</param>
public sealed record AttachmentDto(
    Guid Id,
    Guid TicketId,
    string FileName,
    string ContentType,
    int SizeBytes,
    string Sha256,
    bool IsImage,
    DateTimeOffset UploadedAt,
    UserRefDto UploadedBy,
    string Url,
    bool CanDelete);

/// <summary>An attachment of a doc page (spec 1.3 of the docs refinement); same store, rules and download URL as ticket attachments.</summary>
/// <param name="Url">Download path; the page markdown embeds it as <c>![name](url)</c>.</param>
public sealed record DocAttachmentDto(
    Guid Id,
    string DocKey,
    string FileName,
    string ContentType,
    int SizeBytes,
    string Sha256,
    bool IsImage,
    DateTimeOffset UploadedAt,
    UserRefDto UploadedBy,
    string Url,
    bool CanDelete);

/// <summary>
/// An attachment the caller can read: its metadata, its owner (exactly one of <see cref="TicketId"/> and
/// <see cref="DocNodeId"/>) and the caller's access to the owner's project.
/// </summary>
internal sealed record AttachmentTarget(
    Guid Id,
    Guid? TicketId,
    Guid? DocNodeId,
    Guid ProjectId,
    string FileName,
    string ContentType,
    int SizeBytes,
    string Sha256,
    Guid UploadedById,
    ProjectAccessGrant Grant);

internal static class AttachmentQueries
{
    public static string Url(Guid id) => $"/api/v1/attachments/{id}";

    /// <summary>
    /// Resolves an attachment of a non-deleted ticket or doc in a readable project; anything else is <c>attachment.notFound</c>.
    /// </summary>
    public static async Task<AttachmentTarget> ReadAsync(ITicketingDbContext db, IProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var row = await db.Attachments.AsNoTracking()
            .Where(a => a.Id == id)
            .Select(a => new
            {
                a.Id,
                a.TicketId,
                a.DocNodeId,
                a.FileName,
                a.ContentType,
                a.SizeBytes,
                a.Sha256,
                a.UploadedById,
                ProjectId = db.Tickets.Where(t => t.Id == a.TicketId && t.DeletedAt == null).Select(t => (Guid?)t.ProjectId).FirstOrDefault()
                    ?? db.DocNodes.Where(n => n.Id == a.DocNodeId && n.DeletedAt == null).Select(n => (Guid?)n.ProjectId).FirstOrDefault(),
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (row?.ProjectId is not { } projectId)
            throw NotFound();
        var grant = await access.FindAsync(projectId, cancellationToken) ?? throw NotFound();
        return new AttachmentTarget(
            row.Id, row.TicketId, row.DocNodeId, projectId, row.FileName, row.ContentType, row.SizeBytes, row.Sha256, row.UploadedById, grant);
    }

    public static bool CanDelete(ProjectAccessGrant grant, ICurrentUser currentUser, Guid uploadedById) =>
        grant.CanWrite && !grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly && (grant.IsOwner || uploadedById == currentUser.Id);

    public static async Task<IReadOnlyList<AttachmentDto>> ListAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant grant, Guid ticketId, Guid? onlyId, CancellationToken cancellationToken)
    {
        var rows = await ListedAsync(db, db.Attachments.Where(a => a.TicketId == ticketId), onlyId, cancellationToken);
        return [.. rows.Select(r => new AttachmentDto(
            r.Attachment.Id, ticketId, r.Attachment.FileName, r.Attachment.ContentType, r.Attachment.SizeBytes, r.Attachment.Sha256,
            r.Attachment.IsImage, r.Attachment.UploadedAt, r.UploadedBy, Url(r.Attachment.Id), CanDelete(grant, currentUser, r.Attachment.UploadedById)))];
    }

    public static async Task<IReadOnlyList<DocAttachmentDto>> ListForDocAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant grant, Guid docNodeId, string docKey, Guid? onlyId,
        CancellationToken cancellationToken)
    {
        var rows = await ListedAsync(db, db.Attachments.Where(a => a.DocNodeId == docNodeId), onlyId, cancellationToken);
        return [.. rows.Select(r => new DocAttachmentDto(
            r.Attachment.Id, docKey, r.Attachment.FileName, r.Attachment.ContentType, r.Attachment.SizeBytes, r.Attachment.Sha256,
            r.Attachment.IsImage, r.Attachment.UploadedAt, r.UploadedBy, Url(r.Attachment.Id), CanDelete(grant, currentUser, r.Attachment.UploadedById)))];
    }

    public static AppException NotFound() => AppException.NotFound(AttachmentErrors.NotFound, "The attachment was not found.");

    private static Task<List<Listed>> ListedAsync(
        ITicketingDbContext db, IQueryable<Attachment> attachments, Guid? onlyId, CancellationToken cancellationToken) =>
        (from a in attachments.AsNoTracking()
         join u in db.Users on a.UploadedById equals u.Id
         where onlyId == null || a.Id == onlyId
         orderby a.UploadedAt, a.Id
         select new Listed(a, new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive)))
        .ToListAsync(cancellationToken);

    private sealed record Listed(Attachment Attachment, UserRefDto UploadedBy);
}
