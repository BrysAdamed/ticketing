using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Docs;

/// <summary>
/// A project's docs tree, flat and depth-first in each folder's manual order (at most 5 000 nodes, so not paged), without
/// content. Optionally only the subtree of one folder, a number of levels below it, or some kinds.
/// </summary>
public static class GetDocTree
{
    /// <param name="Folder">A folder key, id or path whose descendants are listed; null lists the whole tree.</param>
    /// <param name="Depth">How many levels below the start to list (1 = direct children); null lists all.</param>
    public sealed record Query(string ProjectKeyOrId, string? Folder = null, int? Depth = null, IReadOnlyList<DocKind>? Kinds = null) : IValidatable
    {
        public void Validate(Validator validator) => validator.Range("depth", Depth, 1, DocTreeShape.MaxDepth);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser) : IHandler<Query, DocTreeDto>
    {
        public async Task<DocTreeDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            request.EnsureValid();
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var start = await DocLookup.FolderAsync(db, grant, request.Folder, "folder", cancellationToken);
            var projectId = grant.ProjectId;
            var me = currentUser.Id;
            var rows = await db.DocNodes.AsNoTracking()
                .Where(n => n.ProjectId == projectId && n.DeletedAt == null)
                .OrderBy(n => n.Rank).ThenBy(n => n.Id)
                .Select(n => new Row(
                    n.Id, n.Number, n.Kind, n.DiagramFormat, n.Title, n.ParentId, n.CurrentVersion, n.UpdatedAt, n.CreatedById,
                    db.DocDrafts.Any(d => d.NodeId == n.Id && d.UserId == me)))
                .ToListAsync(cancellationToken);

            var items = Flatten(rows, start, request.Depth, grant, currentUser);
            if (request.Kinds is { Count: > 0 } kinds)
                items = [.. items.Where(i => kinds.Contains(i.Kind))];
            var canWrite = DocQueries.CanWrite(grant, currentUser);
            return new DocTreeDto(grant.ProjectKey, grant.Role, canWrite, grant.IsOwner && !grant.IsArchived, rows.Count, items);
        }

        private static List<DocTreeItemDto> Flatten(List<Row> rows, Guid? start, int? maxDepth, ProjectAccessGrant grant, ICurrentUser currentUser)
        {
            var byParent = rows.ToLookup(r => r.ParentId);
            var numbers = rows.ToDictionary(r => r.Id, r => r.Number);
            var startDepth = 0;
            for (var current = start; current is { } id; current = rows.First(r => r.Id == id).ParentId)
                startDepth++;

            var items = new List<DocTreeItemDto>(rows.Count);
            var stack = new Stack<(Row Row, int Depth)>(byParent[start].Reverse().Select(r => (r, startDepth + 1)));
            while (stack.TryPop(out var next))
            {
                var (row, depth) = next;
                var children = byParent[row.Id].ToList();
                items.Add(new DocTreeItemDto(
                    row.Id, HumanKeys.Doc(grant.ProjectKey, row.Number), row.Kind, row.DiagramFormat, row.Title,
                    row.ParentId is { } parentId ? HumanKeys.Doc(grant.ProjectKey, numbers[parentId]) : null,
                    depth, row.CurrentVersion, children.Count, row.UpdatedAt, row.HasMyDraft,
                    DocQueries.CanDelete(grant, currentUser, row.CreatedById, row.Kind, children.Count)));
                if (maxDepth is null || depth - startDepth < maxDepth)
                {
                    for (var i = children.Count - 1; i >= 0; i--)
                        stack.Push((children[i], depth + 1));
                }
            }
            return items;
        }

        private sealed record Row(
            Guid Id, int Number, DocKind Kind, DiagramFormat? DiagramFormat, string Title, Guid? ParentId, int CurrentVersion, DateTimeOffset UpdatedAt,
            Guid CreatedById, bool HasMyDraft);
    }
}
