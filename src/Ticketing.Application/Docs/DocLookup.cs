using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>A resolved, readable doc and the caller's access to its project.</summary>
public sealed record DocTarget(Guid Id, Guid ProjectId, int Number, DocKind Kind, ProjectAccessGrant Grant)
{
    public string Key => HumanKeys.Doc(Grant.ProjectKey, Number);
}

/// <summary>
/// The single resolver for user-supplied doc references: a key (<c>WEB-D-12</c>, case-insensitive), an id, or a project and
/// a path (<c>Architecture/ADRs/0001 Use Postgres</c>). Docs in unreadable projects are not found (never 403); deleted docs
/// answer <c>doc.deleted</c> naming who and when.
/// </summary>
public static class DocLookup
{
    public const string Root = "root";

    public static async Task<DocTarget> ReadAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var (row, grant) = await FindAsync(db, access, keyOrId, cancellationToken);
        return new DocTarget(row.Id, row.ProjectId, row.Number, row.Kind, grant);
    }

    /// <summary>Resolves the doc and requires write access to its project (Owner or Member, write-scoped, not archived).</summary>
    public static async Task<DocTarget> WriteAsync(ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var (row, _) = await FindAsync(db, access, keyOrId, cancellationToken);
        var grant = await access.EnsureCanWriteAsync(row.ProjectId, cancellationToken);
        return new DocTarget(row.Id, row.ProjectId, row.Number, row.Kind, grant);
    }

    /// <summary>Like <see cref="WriteAsync"/>, but a deleted doc resolves too (restore is its only use).</summary>
    public static async Task<DocTarget> WriteIncludingDeletedAsync(
        ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken)
    {
        var (row, _) = await FindAsync(db, access, keyOrId, cancellationToken, includeDeleted: true);
        var grant = await access.EnsureCanWriteAsync(row.ProjectId, cancellationToken);
        return new DocTarget(row.Id, row.ProjectId, row.Number, row.Kind, grant);
    }

    /// <summary>Resolves <paramref name="path"/> (titles joined by <c>/</c>, case-insensitive) in a readable project.</summary>
    public static async Task<DocTarget> ReadByPathAsync(
        ITicketingDbContext db, IProjectAccess access, string projectKeyOrId, string path, CancellationToken cancellationToken)
    {
        var grant = await access.EnsureCanReadAsync(projectKeyOrId, cancellationToken);
        var found = await ByPathAsync(db, grant.ProjectId, path, cancellationToken)
            ?? throw AppException.NotFound(DocErrors.NotFound, $"No doc at path '{path.Trim()}' in project {grant.ProjectKey}.");
        return new DocTarget(found.Id, grant.ProjectId, found.Number, found.Kind, grant);
    }

    /// <summary>A key, id or path of a non-deleted folder of the grant's project; null, empty, <c>root</c> or <c>/</c> mean the project root.</summary>
    public static async Task<Guid?> FolderAsync(ITicketingDbContext db, ProjectAccessGrant grant, string? reference, string field, CancellationToken cancellationToken)
    {
        if (IsRoot(reference))
            return null;
        var found = await InProjectAsync(db, grant, reference!, cancellationToken);
        if (found is null || found.Kind != DocKind.Folder)
            throw new AppException(
                ErrorKind.Validation, DocErrors.ParentInvalid,
                found is null ? $"Folder '{reference!.Trim()}' was not found in project {grant.ProjectKey}." : $"'{reference!.Trim()}' is not a folder; only folders hold docs.",
                "Pass a folder key (for example WEB-D-3), a folder path, or 'root'.",
                new Dictionary<string, string[]> { [field] = ["Not a folder of this project."] });
        return found.Id;
    }

    /// <summary>A key, id or path of a non-deleted doc of the grant's project, or null.</summary>
    internal static async Task<Row?> InProjectAsync(ITicketingDbContext db, ProjectAccessGrant grant, string reference, CancellationToken cancellationToken)
    {
        var value = reference.Trim();
        var projectId = grant.ProjectId;
        IQueryable<DocNode> nodes;
        if (Guid.TryParse(value, out var id))
            nodes = db.DocNodes.Where(n => n.Id == id);
        else if (HumanKeys.TryParseDoc(value, out var projectKey, out var number))
            nodes = projectKey == grant.ProjectKey ? db.DocNodes.Where(n => n.Number == number) : db.DocNodes.Where(_ => false);
        else
            return await ByPathAsync(db, projectId, value, cancellationToken);

        return await nodes.AsNoTracking()
            .Where(n => n.ProjectId == projectId && n.DeletedAt == null)
            .Select(n => new Row(n.Id, n.ProjectId, n.Number, n.Kind, n.DeletedAt, null))
            .SingleOrDefaultAsync(cancellationToken);
    }

    internal static bool IsRoot(string? reference) =>
        string.IsNullOrWhiteSpace(reference) || reference.Trim() is "/" || string.Equals(reference.Trim(), Root, StringComparison.OrdinalIgnoreCase);

    internal static AppException NotFound(string reference) =>
        AppException.NotFound(DocErrors.NotFound, $"Doc '{reference.Trim()}' was not found.");

    private static async Task<Row?> ByPathAsync(ITicketingDbContext db, Guid projectId, string path, CancellationToken cancellationToken)
    {
        var segments = DocPaths.Parse(path);
        if (segments is null || segments.Count > DocTreeShape.MaxDepth)
            return null;

        Row? found = null;
        foreach (var segment in segments)
        {
            if (found is { Kind: not DocKind.Folder })
                return null;
            var parentId = found?.Id;
            var title = DocTitles.Key(segment);
            found = await db.DocNodes.AsNoTracking()
                .Where(n => n.ProjectId == projectId && n.DeletedAt == null && n.ParentId == parentId && n.Title.ToLower() == title)
                .Select(n => new Row(n.Id, n.ProjectId, n.Number, n.Kind, n.DeletedAt, null))
                .FirstOrDefaultAsync(cancellationToken);
            if (found is null)
                return null;
        }
        return found;
    }

    private static async Task<(Row Row, ProjectAccessGrant Grant)> FindAsync(
        ITicketingDbContext db, IProjectAccess access, string keyOrId, CancellationToken cancellationToken, bool includeDeleted = false)
    {
        IQueryable<DocNode> nodes;
        var value = keyOrId.Trim();
        if (Guid.TryParse(value, out var id))
            nodes = db.DocNodes.Where(n => n.Id == id);
        else if (HumanKeys.TryParseDoc(value, out var projectKey, out var number))
            nodes = db.DocNodes.Where(n => n.Number == number && db.Projects.Any(p => p.Id == n.ProjectId && p.Key == projectKey));
        else
            throw NotFound(keyOrId);

        var row = await nodes.AsNoTracking()
            .Select(n => new Row(
                n.Id, n.ProjectId, n.Number, n.Kind, n.DeletedAt,
                db.Users.Where(u => u.Id == n.DeletedById).Select(u => u.DisplayName).FirstOrDefault()))
            .SingleOrDefaultAsync(cancellationToken) ?? throw NotFound(keyOrId);
        var grant = await access.FindAsync(row.ProjectId, cancellationToken) ?? throw NotFound(keyOrId);
        if (row.DeletedAt is not null && !includeDeleted)
            throw AppException.NotFound(
                DocErrors.Deleted,
                string.Create(CultureInfo.InvariantCulture,
                    $"{HumanKeys.Doc(grant.ProjectKey, row.Number)} was deleted by {row.DeletedBy ?? "someone"} on {row.DeletedAt:yyyy-MM-dd}."));
        return (row, grant);
    }

    internal sealed record Row(Guid Id, Guid ProjectId, int Number, DocKind Kind, DateTimeOffset? DeletedAt, string? DeletedBy);
}
