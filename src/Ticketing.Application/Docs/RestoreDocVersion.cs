using System.Globalization;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Restores version <c>n</c> of a page or diagram (spec 1.6): publishes its title and content as a new version with
/// <c>RestoredFrom = n</c>, so nothing is lost. No <c>baseVersion</c> is needed. When the latest version already has that
/// title and content, nothing is written. A sibling holding the old title fails with <c>doc.title.duplicate</c>.
/// </summary>
public static class RestoreDocVersion
{
    public sealed record Command(string? ChangeNote = null) : IValidatable
    {
        [JsonIgnore]
        public string KeyOrId { get; init; } = string.Empty;

        [JsonIgnore]
        public int Number { get; init; }

        public void Validate(Validator validator) => validator.MaxLength("changeNote", ChangeNote, DocNode.ChangeNoteMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser, IClock clock, DocPublisher publisher)
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
            node.EnsureHasContent();
            var number = command.Number;
            var version = await db.DocVersions.AsNoTracking()
                .Where(v => v.NodeId == node.Id && v.Number == number)
                .Select(v => new { v.Title, v.Content })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(
                    DocErrors.VersionNotFound, string.Create(CultureInfo.InvariantCulture, $"{target.Key} has no version {number}."));

            var titleChanged = !string.Equals(version.Title, node.Title, StringComparison.Ordinal);
            if (!titleChanged && string.Equals(version.Content, node.Content ?? string.Empty, StringComparison.Ordinal))
                return false;

            if (titleChanged)
            {
                await DocTree.EnsureTitleFreeAsync(db, node.ProjectId, node.ParentId, version.Title, node.Id, cancellationToken);
                node.Rename(version.Title, currentUser.Id, clock.Now);
            }

            await publisher.PublishAsync(node, version.Content, command.ChangeNote, number, cancellationToken);
            await DocTree.SaveAsync(db, node.Title, cancellationToken);
            return true;
        }
    }
}
