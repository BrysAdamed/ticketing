using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>Where a doc goes inside its target folder: at the top or bottom, or right before or after a sibling (key, id or path).</summary>
public sealed record DocPlacement(DocPosition? Position, string? BeforeKey, string? AfterKey)
{
    public static DocPlacement Bottom { get; } = new(DocPosition.Bottom, null, null);

    public void Validate(Validator validator) =>
        validator.Must(
            new object?[] { Position, BeforeKey, AfterKey }.Count(v => v is not null) <= 1,
            "position", "Give at most one of position, beforeKey and afterKey.");
}

/// <summary>
/// Shared steps of the tree use cases. Tree changes (create, move, duplicate, delete, restore) call <see cref="LockAsync"/>
/// first inside <c>InTransactionAsync</c>: it takes the project's docs tree lock (the same lock the ranker takes for doc
/// folders) and loads the tree shape, so limit, depth and cycle checks cannot race.
/// </summary>
public static class DocTree
{
    public const string SiblingTitleIndex = "ux_doc_nodes_sibling_title";

    public static async Task<DocTreeShape> LockAsync(ITicketingDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        if (db.Database.CurrentTransaction is null)
            throw new InvalidOperationException("The docs tree lock needs an open transaction; wrap the work in InTransactionAsync.");
        var key = DocFolderContainer.TreeLockKey(projectId);
        await db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock(hashtextextended({key}, 0))", cancellationToken);
        var nodes = await db.DocNodes.AsNoTracking()
            .Where(n => n.ProjectId == projectId && n.DeletedAt == null)
            .Select(n => new DocTreeNode(n.Id, n.ParentId, n.Kind))
            .ToListAsync(cancellationToken);
        return new DocTreeShape(nodes);
    }

    /// <summary>Loads the node tracked and row-locked (<c>FOR UPDATE</c>) so content versions are allocated one at a time.</summary>
    public static Task<DocNode> LockNodeAsync(ITicketingDbContext db, Guid id, CancellationToken cancellationToken) =>
        db.DocNodes.FromSql($"SELECT *, xmin FROM doc_nodes WHERE id = {id} FOR UPDATE").SingleAsync(cancellationToken);

    /// <summary>Saves, turning a sibling-title race (the partial unique index) into <c>doc.title.duplicate</c>.</summary>
    public static async Task SaveAsync(ITicketingDbContext db, string title, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.IsUniqueViolation(SiblingTitleIndex))
        {
            throw DocTitles.Duplicate(title);
        }
    }

    public static async Task<string?> KeyOfAsync(ITicketingDbContext db, ProjectAccessGrant grant, Guid? id, CancellationToken cancellationToken) =>
        id is { } value
            ? HumanKeys.Doc(grant.ProjectKey, await db.DocNodes.AsNoTracking().Where(n => n.Id == value).Select(n => n.Number).SingleAsync(cancellationToken))
            : null;

    public static async Task<HashSet<string>> SiblingTitlesAsync(
        ITicketingDbContext db, Guid projectId, Guid? parentId, Guid? excludeId, CancellationToken cancellationToken) =>
        new(await db.DocNodes.AsNoTracking()
                .Where(n => n.ProjectId == projectId && n.DeletedAt == null && n.ParentId == parentId && n.Id != excludeId)
                .Select(n => n.Title)
                .ToListAsync(cancellationToken),
            DocTitles.Comparer);

    public static async Task EnsureTitleFreeAsync(
        ITicketingDbContext db, Guid projectId, Guid? parentId, string title, Guid? excludeId, CancellationToken cancellationToken)
    {
        var key = DocTitles.Key(title);
        if (await db.DocNodes.AnyAsync(
                n => n.ProjectId == projectId && n.DeletedAt == null && n.ParentId == parentId && n.Id != excludeId && n.Title.ToLower() == key,
                cancellationToken))
            throw DocTitles.Duplicate(title);
    }

    /// <summary>
    /// Content replacements must start from the latest version (spec 1.7): a missing <paramref name="baseVersion"/> is
    /// <c>doc.baseVersion.required</c>, a stale one <c>doc.version.conflict</c> carrying the current version, its author and time.
    /// </summary>
    public static async Task EnsureBaseVersionAsync(ITicketingDbContext db, DocTarget target, DocNode node, int? baseVersion, CancellationToken cancellationToken)
    {
        if (baseVersion is null)
            throw new AppException(
                ErrorKind.Validation, DocErrors.BaseVersionRequired, "baseVersion is required when the content is replaced.",
                "Send the version your edit started from (version in get_doc), or use edit_doc for small changes.",
                new Dictionary<string, string[]> { ["baseVersion"] = ["baseVersion is required with content."] });
        if (baseVersion == node.CurrentVersion)
            return;

        var nodeId = node.Id;
        var number = node.CurrentVersion;
        var latest = await (
                from v in db.DocVersions.AsNoTracking()
                where v.NodeId == nodeId && v.Number == number
                join u in db.Users on v.AuthorId equals u.Id
                select new { v.CreatedAt, User = new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive) })
            .SingleAsync(cancellationToken);
        throw new AppException(
            ErrorKind.Conflict, DocErrors.VersionConflict,
            string.Create(CultureInfo.InvariantCulture, $"{target.Key} changed since v{baseVersion}: the latest version is v{number} by {latest.User.DisplayName}."),
            string.Create(CultureInfo.InvariantCulture, $"Merge your change into the latest content (get_doc) and send baseVersion {number}, or use edit_doc."))
        {
            Details = new Dictionary<string, object?>
            {
                ["currentVersion"] = number,
                ["updatedBy"] = latest.User,
                ["updatedAt"] = latest.CreatedAt,
            },
        };
    }

    /// <summary>A rank in <paramref name="parentId"/> at <paramref name="placement"/>; anchors must be siblings in that folder.</summary>
    public static async Task<string> RankAsync(
        ITicketingDbContext db, ITicketRanker ranker, ProjectAccessGrant grant, Guid? parentId, DocPlacement placement, IReadOnlyCollection<Guid> movingIds,
        CancellationToken cancellationToken)
    {
        var anchor = placement switch
        {
            { BeforeKey: { } before } => RankAnchor.Before(await AnchorAsync(db, grant, before, parentId, movingIds, cancellationToken)),
            { AfterKey: { } after } => RankAnchor.After(await AnchorAsync(db, grant, after, parentId, movingIds, cancellationToken)),
            { Position: DocPosition.Top } => RankAnchor.Top,
            _ => RankAnchor.Bottom,
        };
        return (await ranker.PlaceManyAsync(RankContainer.DocFolder(grant.ProjectId, parentId), anchor, 1, movingIds, cancellationToken))[0];
    }

    private static async Task<Guid> AnchorAsync(
        ITicketingDbContext db, ProjectAccessGrant grant, string reference, Guid? parentId, IReadOnlyCollection<Guid> movingIds, CancellationToken cancellationToken)
    {
        var found = await DocLookup.InProjectAsync(db, grant, reference, cancellationToken);
        var foundParentId = found is null
            ? null
            : await db.DocNodes.AsNoTracking().Where(n => n.Id == found.Id).Select(n => n.ParentId).SingleAsync(cancellationToken);
        if (found is null || movingIds.Contains(found.Id) || foundParentId != parentId)
            throw new AppException(
                ErrorKind.Conflict, DocErrors.RankAnchorInvalid, $"'{reference.Trim()}' is not a doc of the target folder.",
                "beforeKey and afterKey must name another doc in the folder the doc goes to.");
        return found.Id;
    }
}
