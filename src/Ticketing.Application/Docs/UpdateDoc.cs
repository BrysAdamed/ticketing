using System.Text.Json.Serialization;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Renames a doc and/or publishes new content (spec 1.4, 1.6, 1.7). A rename alone writes <c>doc.renamed</c> and no
/// version. Content needs <c>baseVersion</c> (the version the edit started from); unchanged content creates no version but
/// still discards the caller's draft (it was published as is).
/// </summary>
public static class UpdateDoc
{
    public const string RenamedAction = "doc.renamed";

    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string KeyOrId { get; init; } = string.Empty;

        public string? Title { get; init; }

        /// <summary>The full new markdown (pages) or source (diagrams); null leaves the content unchanged.</summary>
        public string? Content { get; init; }

        public int? BaseVersion { get; init; }

        public string? ChangeNote { get; init; }

        /// <summary>Canvas only: the SVG picture of <see cref="Content"/>, stored with the version it publishes.</summary>
        public string? Snapshot { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (Title is not null)
                validator
                    .Required("title", Title, DocNode.TitleMaxLength)
                    .Must(!Title.Contains('\n', StringComparison.Ordinal), "title", "title must be a single line.");
            validator
                .MaxLength("changeNote", ChangeNote, DocNode.ChangeNoteMaxLength)
                .Must(Snapshot is null || Content is not null, "snapshot", "snapshot is only sent together with content.");
        }
    }

    public sealed class Handler(
        ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, IActivityLog activity, DocPublisher publisher)
        : IHandler<Command, DocDto>
    {
        public async Task<DocDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await DocLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            await db.InTransactionAsync(ct => ApplyAsync(command, target, ct), cancellationToken);
            return await DocQueries.LoadAsync(db, access, currentUser, clock, target, cancellationToken);
        }

        private async Task<bool> ApplyAsync(Command command, DocTarget target, CancellationToken cancellationToken)
        {
            var node = await DocTree.LockNodeAsync(db, target.Id, cancellationToken);
            db.ExpectVersion(node, command.ExpectedVersion);
            if (command.Content is not null)
            {
                node.EnsureHasContent();
                await DocTree.EnsureBaseVersionAsync(db, target, node, command.BaseVersion, cancellationToken);
            }

            if (command.Title is not null)
            {
                var oldTitle = node.Title;
                var title = DocTitles.Normalize(command.Title);
                if (!string.Equals(title, oldTitle, StringComparison.Ordinal))
                {
                    await DocTree.EnsureTitleFreeAsync(db, node.ProjectId, node.ParentId, title, node.Id, cancellationToken);
                    node.Rename(title, currentUser.Id, clock.Now);
                    activity.RecordChange(ActivityEntityType.Doc, node.Id, node.ProjectId, RenamedAction, "title", oldTitle, node.Title);
                }
            }

            if (command.Content is not null)
            {
                var prepared = await publisher.PrepareContentAsync(target.Grant, node.Kind, node.Content, command.Content, cancellationToken);
                var content = DocContent.Normalize(prepared, node.Kind, node.DiagramFormat);
                if (string.Equals(content, node.Content, StringComparison.Ordinal))
                {
                    await publisher.DiscardMyDraftAsync(node.Id, cancellationToken);
                    if (command.Snapshot is not null && node.IsCanvas)
                        await publisher.AttachSnapshotAsync(node.Id, node.CurrentVersion, command.Snapshot, cancellationToken);
                }
                else
                {
                    await publisher.PublishAsync(node, content, command.ChangeNote, null, command.Snapshot, cancellationToken);
                }
            }

            await DocTree.SaveAsync(db, node.Title, cancellationToken);
            return true;
        }
    }
}
