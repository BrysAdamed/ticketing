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

/// <summary>An attachment the caller can read: its metadata and the caller's access to the ticket's project.</summary>
internal sealed record AttachmentTarget(
    Guid Id, Guid TicketId, Guid ProjectId, string FileName, string ContentType, int SizeBytes, string Sha256, Guid UploadedById, ProjectAccessGrant Grant);

internal static class AttachmentQueries
{
    public static string Url(Guid id) => $"/api/v1/attachments/{id}";

    /// <summary>Resolves an attachment of a non-deleted ticket in a readable project; anything else is <c>attachment.notFound</c>.</summary>
    public static async Task<AttachmentTarget> ReadAsync(ITicketingDbContext db, IProjectAccess access, Guid id, CancellationToken cancellationToken)
    {
        var row = await (
                from a in db.Attachments.AsNoTracking()
                join t in db.Tickets on a.TicketId equals t.Id
                where a.Id == id && t.DeletedAt == null
                select new { a.Id, a.TicketId, t.ProjectId, a.FileName, a.ContentType, a.SizeBytes, a.Sha256, a.UploadedById })
            .SingleOrDefaultAsync(cancellationToken) ?? throw NotFound();
        var grant = await access.FindAsync(row.ProjectId, cancellationToken) ?? throw NotFound();
        return new AttachmentTarget(row.Id, row.TicketId, row.ProjectId, row.FileName, row.ContentType, row.SizeBytes, row.Sha256, row.UploadedById, grant);
    }

    public static bool CanDelete(ProjectAccessGrant grant, ICurrentUser currentUser, Guid uploadedById) =>
        grant.CanWrite && !grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly && (grant.IsOwner || uploadedById == currentUser.Id);

    public static async Task<IReadOnlyList<AttachmentDto>> ListAsync(
        ITicketingDbContext db, ICurrentUser currentUser, ProjectAccessGrant grant, Guid ticketId, Guid? onlyId, CancellationToken cancellationToken)
    {
        var rows = await (
                from a in db.Attachments.AsNoTracking()
                join u in db.Users on a.UploadedById equals u.Id
                where a.TicketId == ticketId && (onlyId == null || a.Id == onlyId)
                orderby a.UploadedAt, a.Id
                select new { Attachment = a, u.Email, u.DisplayName, u.IsActive })
            .ToListAsync(cancellationToken);
        return [.. rows.Select(r => new AttachmentDto(
            r.Attachment.Id, r.Attachment.TicketId, r.Attachment.FileName, r.Attachment.ContentType, r.Attachment.SizeBytes, r.Attachment.Sha256,
            r.Attachment.IsImage, r.Attachment.UploadedAt, new UserRefDto(r.Attachment.UploadedById, r.Email, r.DisplayName, r.IsActive),
            Url(r.Attachment.Id), CanDelete(grant, currentUser, r.Attachment.UploadedById)))];
    }

    public static AppException NotFound() => AppException.NotFound(AttachmentErrors.NotFound, "The attachment was not found.");
}
