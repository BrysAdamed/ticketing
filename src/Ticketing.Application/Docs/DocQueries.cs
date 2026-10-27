using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Docs;

/// <summary>Shared read projections and permission rules for docs (one query each, no N+1).</summary>
public static class DocQueries
{
    /// <summary>A draft changed within this window makes its owner show as "editing" (spec 1.7).</summary>
    public static readonly TimeSpan PresenceWindow = TimeSpan.FromMinutes(10);

    public static string Url(string projectKey, string key, string title) => $"/p/{projectKey}/docs/{key}/{DocPaths.Slug(title)}";

    /// <summary>Where the Canvas picture of version <paramref name="number"/> is served (<c>GET</c>, readers).</summary>
    public static string SnapshotUrl(string key, int number) =>
        string.Create(CultureInfo.InvariantCulture, $"/api/v1/docs/{key}/versions/{number}/snapshot.svg");

    public static bool CanWrite(ProjectAccessGrant grant, ICurrentUser currentUser) =>
        grant.CanWrite && !grant.IsArchived && currentUser.PatScope != PatScope.ReadOnly;

    /// <summary>Owners delete anything; Members only nodes they created, and folders only while empty (spec 1.5).</summary>
    public static bool CanDelete(ProjectAccessGrant grant, ICurrentUser currentUser, Guid createdById, DocKind kind, int childCount) =>
        CanWrite(grant, currentUser) && (grant.IsOwner || (createdById == currentUser.Id && (kind != DocKind.Folder || childCount == 0)));

    /// <summary>Titles and parents of the project's folders, for paths, breadcrumbs and parent keys.</summary>
    public static async Task<DocFolderIndex> FoldersAsync(ITicketingDbContext db, Guid projectId, bool includeDeleted, CancellationToken cancellationToken)
    {
        var folders = await db.DocNodes.AsNoTracking()
            .Where(n => n.ProjectId == projectId && n.Kind == DocKind.Folder && (includeDeleted || n.DeletedAt == null))
            .Select(n => new DocFolderIndex.Folder(n.Id, n.ParentId, n.Number, n.Title))
            .ToListAsync(cancellationToken);
        return new DocFolderIndex(folders);
    }

    /// <summary>The doc with everything <see cref="DocDto"/> carries, references and backlinks filtered for the reader.</summary>
    public static async Task<DocDto> LoadAsync(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, DocTarget target, CancellationToken cancellationToken)
    {
        var id = target.Id;
        var me = currentUser.Id;
        var row = await (
                from n in db.DocNodes.AsNoTracking()
                where n.Id == id
                join c in db.Users on n.CreatedById equals c.Id
                join u in db.Users on n.UpdatedById equals u.Id
                select new
                {
                    n.Id,
                    n.ProjectId,
                    n.Number,
                    n.Kind,
                    n.DiagramFormat,
                    n.ParentId,
                    n.Title,
                    n.Content,
                    n.Outline,
                    n.CurrentVersion,
                    HasSnapshot = db.DocVersions.Any(v => v.NodeId == n.Id && v.Number == n.CurrentVersion && v.SnapshotSvg != null),
                    n.CreatedAt,
                    n.CreatedById,
                    n.UpdatedAt,
                    n.RowVersion,
                    CreatedBy = new { c.Id, c.Email, c.DisplayName, c.IsActive },
                    UpdatedBy = new { u.Id, u.Email, u.DisplayName, u.IsActive },
                    ChildCount = db.DocNodes.Count(x => x.ParentId == n.Id && x.DeletedAt == null),
                    CommentCount = db.Comments.Count(x => x.DocNodeId == n.Id && x.DeletedAt == null),
                })
            .SingleAsync(cancellationToken);

        var since = clock.Now - PresenceWindow;
        var editors = await (
                from d in db.DocDrafts.AsNoTracking()
                where d.NodeId == id && d.UserId != me && d.UpdatedAt >= since
                join u in db.Users on d.UserId equals u.Id
                orderby d.CreatedAt, u.Id
                select new { u.Id, u.Email, u.DisplayName, u.IsActive, d.CreatedAt, d.UpdatedAt })
            .ToListAsync(cancellationToken);
        var myDraft = await db.DocDrafts.AsNoTracking()
            .Where(d => d.NodeId == id && d.UserId == me)
            .Select(d => new DocMyDraftDto(d.BaseVersion, d.UpdatedAt))
            .FirstOrDefaultAsync(cancellationToken);
        var folders = await FoldersAsync(db, row.ProjectId, includeDeleted: false, cancellationToken);
        var children = row.Kind == DocKind.Folder ? await ChildrenAsync(db, currentUser, target, folders.DepthUnder(row.Id), cancellationToken) : null;
        var (references, embeds) = await DocReferenceQueries.ReferencesAsync(db, access, id, row.Content, row.Kind, row.DiagramFormat, cancellationToken);
        var backlinks = await DocReferenceQueries.MentioningAsync(db, access, DocReferenceTarget.Doc, id, DocReferenceQueries.DocBacklinksLimit, cancellationToken);

        var projectKey = target.Grant.ProjectKey;
        var key = HumanKeys.Doc(projectKey, row.Number);
        return new DocDto(
            row.Id, key, row.ProjectId, projectKey, row.Kind, row.DiagramFormat, row.Title,
            folders.PathOf(row.ParentId, row.Title), folders.KeyOf(row.ParentId, projectKey), folders.Breadcrumb(row.ParentId, projectKey),
            row.Content, row.CurrentVersion,
            new UserRefDto(row.CreatedBy.Id, row.CreatedBy.Email, row.CreatedBy.DisplayName, row.CreatedBy.IsActive), row.CreatedAt,
            new UserRefDto(row.UpdatedBy.Id, row.UpdatedBy.Email, row.UpdatedBy.DisplayName, row.UpdatedBy.IsActive), row.UpdatedAt,
            target.Grant.Role,
            new DocPermissionsDto(CanWrite(target.Grant, currentUser), CanDelete(target.Grant, currentUser, row.CreatedById, row.Kind, row.ChildCount)),
            [.. editors.Select(e => new DocEditorDto(new UserRefDto(e.Id, e.Email, e.DisplayName, e.IsActive), e.CreatedAt, e.UpdatedAt))],
            myDraft,
            children,
            Url(projectKey, key, row.Title),
            row.RowVersion,
            row.CommentCount,
            references,
            embeds,
            backlinks)
        {
            Outline = row.DiagramFormat == DiagramFormat.Canvas ? row.Outline ?? string.Empty : null,
            SnapshotUrl = row.HasSnapshot ? SnapshotUrl(key, row.CurrentVersion) : null,
        };
    }

    /// <summary>The non-deleted children of a folder in their manual order.</summary>
    public static async Task<IReadOnlyList<DocTreeItemDto>> ChildrenAsync(
        ITicketingDbContext db, ICurrentUser currentUser, DocTarget folder, int depth, CancellationToken cancellationToken)
    {
        var parentId = folder.Id;
        var me = currentUser.Id;
        var projectKey = folder.Grant.ProjectKey;
        var parentKey = folder.Key;
        var rows = await db.DocNodes.AsNoTracking()
            .Where(n => n.ParentId == parentId && n.DeletedAt == null)
            .OrderBy(n => n.Rank).ThenBy(n => n.Id)
            .Select(n => new
            {
                n.Id,
                n.Number,
                n.Kind,
                n.DiagramFormat,
                n.Title,
                n.CurrentVersion,
                n.UpdatedAt,
                n.CreatedById,
                ChildCount = db.DocNodes.Count(x => x.ParentId == n.Id && x.DeletedAt == null),
                HasMyDraft = db.DocDrafts.Any(d => d.NodeId == n.Id && d.UserId == me),
            })
            .ToListAsync(cancellationToken);
        return [.. rows.Select(r => new DocTreeItemDto(
            r.Id, HumanKeys.Doc(projectKey, r.Number), r.Kind, r.DiagramFormat, r.Title, parentKey, depth, r.CurrentVersion, r.ChildCount, r.UpdatedAt,
            r.HasMyDraft, CanDelete(folder.Grant, currentUser, r.CreatedById, r.Kind, r.ChildCount)))];
    }
}

/// <summary>The folders of one project (id, parent, number, title): paths, breadcrumbs and parent keys without recursive SQL.</summary>
public sealed class DocFolderIndex(IEnumerable<DocFolderIndex.Folder> folders)
{
    private readonly Dictionary<Guid, Folder> _folders = folders.ToDictionary(f => f.Id);

    public string? KeyOf(Guid? folderId, string projectKey) =>
        folderId is { } id && _folders.TryGetValue(id, out var folder) ? HumanKeys.Doc(projectKey, folder.Number) : null;

    /// <summary>The path of a doc titled <paramref name="title"/> placed in <paramref name="parentId"/>.</summary>
    public string PathOf(Guid? parentId, string title) => DocPaths.Format([.. Ancestors(parentId).Select(f => f.Title), title]);

    public string FolderPath(Guid? folderId) => DocPaths.Format(Ancestors(folderId).Select(f => f.Title));

    /// <summary>The depth of a doc placed in <paramref name="parentId"/> (root children are depth 1).</summary>
    public int DepthUnder(Guid? parentId) => Ancestors(parentId).Count + 1;

    public IReadOnlyList<DocCrumbDto> Breadcrumb(Guid? parentId, string projectKey) =>
        [.. Ancestors(parentId).Select(f => new DocCrumbDto(HumanKeys.Doc(projectKey, f.Number), f.Title))];

    /// <summary>The folders from the root down to <paramref name="folderId"/> (inclusive).</summary>
    private List<Folder> Ancestors(Guid? folderId)
    {
        var chain = new List<Folder>();
        for (var current = folderId; current is { } id && _folders.TryGetValue(id, out var folder) && chain.Count <= DocTreeShape.MaxDepth; current = folder.ParentId)
            chain.Add(folder);
        chain.Reverse();
        return chain;
    }

    public sealed record Folder(Guid Id, Guid? ParentId, int Number, string Title);
}
