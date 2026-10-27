using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Moves a doc (a folder with its subtree) to another folder of the project and/or another position among its siblings
/// (spec 1.4). Rejected: a folder into its own subtree (<c>doc.tree.cycle</c>), deeper than 6 levels (<c>doc.tree.depth</c>),
/// a full folder, a sibling title clash. A parent change writes <c>doc.moved</c>; no version is created.
/// </summary>
public static class MoveDoc
{
    public const string Action = "doc.moved";

    /// <param name="Parent">Target folder key, id or path, or <c>root</c>; null keeps the current folder (reorder only).</param>
    public sealed record Command(
        string? Parent = null,
        DocPosition? Position = null,
        string? BeforeKey = null,
        string? AfterKey = null,
        [property: JsonIgnore] string KeyOrId = "") : IValidatable
    {
        public DocPlacement Placement => new(Position, BeforeKey, AfterKey);

        public void Validate(Validator validator) => Placement.Validate(validator);
    }

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, ITicketRanker ranker)
        : IHandler<Command, DocDto>
    {
        public async Task<DocDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            await db.InTransactionAsync(
                async ct =>
                {
                    var shape = await DocTree.LockAsync(db, target.ProjectId, ct);
                    var node = await DocTree.LockNodeAsync(db, target.Id, ct);
                    var oldParentId = node.ParentId;
                    var parentId = command.Parent is null ? oldParentId : await DocLookup.FolderAsync(db, target.Grant, command.Parent, "parent", ct);
                    shape.EnsureCanMove(node.Id, parentId);
                    if (parentId != oldParentId)
                        await DocTree.EnsureTitleFreeAsync(db, node.ProjectId, parentId, node.Title, node.Id, ct);

                    var rank = await DocTree.RankAsync(db, ranker, target.Grant, parentId, command.Placement, [node.Id], ct);
                    node.MoveTo(parentId, rank, currentUser.Id, clock.Now);
                    if (parentId != oldParentId)
                        activity.RecordChange(
                            ActivityEntityType.Doc, node.Id, node.ProjectId, Action, "parent",
                            await DocTree.KeyOfAsync(db, target.Grant, oldParentId, ct), await DocTree.KeyOfAsync(db, target.Grant, parentId, ct));
                    await DocTree.SaveAsync(db, node.Title, ct);
                    return true;
                },
                cancellationToken);
            return await DocQueries.LoadAsync(db, currentUser, clock, target, cancellationToken);
        }
    }
}
