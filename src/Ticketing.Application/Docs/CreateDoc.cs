using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Docs;

/// <summary>
/// Creates a folder, page or diagram (spec 1.4) inside the root or a folder, at the bottom (default), the top, or next to a
/// sibling. The key number and the rank are allocated in the insert transaction under the project's docs tree lock. A page
/// or diagram starts at version 1 with the given content, possibly empty.
/// </summary>
public static class CreateDoc
{
    public const string Action = "doc.created";

    public sealed record Command(
        DocKind? Kind,
        string Title,
        string? Parent = null,
        DocPosition? Position = null,
        string? BeforeKey = null,
        string? AfterKey = null,
        string? Content = null,
        DiagramFormat? DiagramFormat = null,
        string? ChangeNote = null,
        string? Snapshot = null,
        [property: JsonIgnore] string ProjectKeyOrId = "",
        [property: JsonIgnore] string? IdempotencyKey = null) : IValidatable
    {
        public DocPlacement Placement => new(Position, BeforeKey, AfterKey);

        public void Validate(Validator validator)
        {
            validator
                .Must(Kind is not null, "kind", "kind is required (Folder, Page or Diagram).")
                .Required("title", Title, DocNode.TitleMaxLength)
                .Must(Title is null || !Title.Contains('\n', StringComparison.Ordinal), "title", "title must be a single line.")
                .MaxLength("changeNote", ChangeNote, DocNode.ChangeNoteMaxLength)
                .Must(Kind != DocKind.Folder || Content is null, "content", "Folders have no content.")
                .Must(Kind != DocKind.Diagram || DiagramFormat is not null, "diagramFormat", "diagramFormat is required for diagrams (Mermaid or Canvas).")
                .Must(Kind == DocKind.Diagram || DiagramFormat is null, "diagramFormat", "diagramFormat is only allowed for diagrams.")
                .Must(Snapshot is null || DiagramFormat == Domain.Docs.DiagramFormat.Canvas, "snapshot", "snapshot is only for Canvas diagrams.");
            Placement.Validate(validator);
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IProjectCounters counters,
        ITicketRanker ranker,
        IIdempotency idempotency,
        DocPublisher publisher) : IHandler<Command, DocDto>
    {
        public async Task<DocDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureCanWriteAsync(command.ProjectKeyOrId, cancellationToken);
            return await idempotency.ExecuteAsync(
                command.IdempotencyKey, "docs.create", command with { IdempotencyKey = null, ProjectKeyOrId = grant.ProjectId.ToString() },
                ct => db.InTransactionAsync(
                    async inner =>
                    {
                        var node = await CreateAsync(grant, command, inner);
                        return await DocQueries.LoadAsync(db, access, currentUser, clock, new DocTarget(node.Id, node.ProjectId, node.Number, node.Kind, grant), inner);
                    },
                    ct),
                cancellationToken);
        }

        private async Task<DocNode> CreateAsync(ProjectAccessGrant grant, Command command, CancellationToken cancellationToken)
        {
            var shape = await DocTree.LockAsync(db, grant.ProjectId, cancellationToken);
            var parentId = await DocLookup.FolderAsync(db, grant, command.Parent, "parent", cancellationToken);
            shape.EnsureCanAdd(parentId);
            var title = DocTitles.Normalize(command.Title);
            await DocTree.EnsureTitleFreeAsync(db, grant.ProjectId, parentId, title, null, cancellationToken);
            var rank = await DocTree.RankAsync(db, ranker, grant, parentId, command.Placement, [], cancellationToken);
            var number = await counters.NextAsync(grant.ProjectId, CounterKind.Doc, cancellationToken);

            var now = clock.Now;
            var kind = command.Kind!.Value;
            var node = kind == DocKind.Folder
                ? DocNode.CreateFolder(grant.ProjectId, number, parentId, rank, title, currentUser.Id, now)
                : DocNode.CreateDocument(
                    grant.ProjectId, number, kind, command.DiagramFormat, parentId, rank, title,
                    await publisher.PrepareContentAsync(grant, kind, null, command.Content, cancellationToken), currentUser.Id, now);
            db.DocNodes.Add(node);
            if (!node.IsFolder)
                await publisher.AddInitialVersionAsync(node, command.ChangeNote, command.Snapshot, cancellationToken);
            activity.Record(ActivityEntityType.Doc, node.Id, grant.ProjectId, Action, new
            {
                key = node.KeyIn(grant.ProjectKey),
                node.Kind,
                node.DiagramFormat,
                node.Title,
                parentKey = await DocTree.KeyOfAsync(db, grant, parentId, cancellationToken),
            });
            await DocTree.SaveAsync(db, title, cancellationToken);
            return node;
        }
    }
}
