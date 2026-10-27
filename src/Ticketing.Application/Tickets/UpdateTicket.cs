using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Boards;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// PATCH a ticket (spec 6.2, 6.3): omitted fields stay, null clears an optional field. Every changed field writes one
/// <c>ticket.field.changed</c> entry with the same timestamp. Status side effects (resolution, resolved date, leaving
/// Done on an archived board) are applied in the same transaction.
/// </summary>
public static class UpdateTicket
{
    public const string FieldChanged = "ticket.field.changed";

    public sealed record Command : IValidatable
    {
        [JsonIgnore]
        public string KeyOrId { get; init; } = string.Empty;

        public Optional<string> Title { get; init; }

        public Optional<string?> Description { get; init; }

        public Optional<TicketType> Type { get; init; }

        public Optional<TicketStatus> Status { get; init; }

        public Optional<Resolution?> Resolution { get; init; }

        public Optional<Priority> Priority { get; init; }

        public Optional<Severity?> Severity { get; init; }

        public Optional<int?> StoryPoints { get; init; }

        public Optional<string?> Version { get; init; }

        /// <summary>Replaces all labels.</summary>
        public Optional<IReadOnlyList<string>?> Labels { get; init; }

        public IReadOnlyList<string>? AddLabels { get; init; }

        public IReadOnlyList<string>? RemoveLabels { get; init; }

        /// <summary>Parent ticket key or id; null makes the ticket top level.</summary>
        public Optional<string?> ParentKey { get; init; }

        /// <summary>User id, email or <c>me</c>; null unassigns.</summary>
        public Optional<string?> Assignee { get; init; }

        /// <summary>User id, email or <c>me</c>.</summary>
        public Optional<string> Reporter { get; init; }

        [JsonIgnore]
        public uint? ExpectedVersion { get; init; }

        public void Validate(Validator validator)
        {
            if (Title.HasValue)
                validator
                    .Required("title", Title.Value, Ticket.TitleMaxLength)
                    .Must(Title.Value is null || !Title.Value.Contains('\n', StringComparison.Ordinal), "title", "title must be a single line.");
            if (Description.HasValue)
                validator.MaxLength("description", Description.Value, Ticket.DescriptionMaxLength);
            if (Version.HasValue)
                validator.MaxLength("version", Version.Value, Ticket.VersionMaxLength);
            if (StoryPoints.HasValue)
                validator.Range("storyPoints", StoryPoints.Value, 0, Ticket.MaxStoryPoints);
            if (Reporter.HasValue)
                validator.Must(!string.IsNullOrWhiteSpace(Reporter.Value), "reporter", "reporter cannot be empty.");
        }
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        ITicketRanker ranker) : IHandler<Command, TicketDto>
    {
        public async Task<TicketDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var target = await TicketLookup.WriteAsync(db, access, command.KeyOrId, cancellationToken);
            await db.InTransactionAsync(ct => ApplyAsync(command, target, ct), cancellationToken);
            return await GetTicket.Handler.LoadAsync(db, access, currentUser, target, TicketIncludes.None, cancellationToken);
        }

        private async Task<bool> ApplyAsync(Command command, TicketTarget target, CancellationToken cancellationToken)
        {
            var ticket = await db.Tickets.SingleAsync(t => t.Id == target.Id, cancellationToken);
            db.ExpectVersion(ticket, command.ExpectedVersion);
            var now = clock.Now;
            var changes = new Changes(activity, ticket.Id, target.ProjectId);

            if (command.Title.HasValue)
                changes.Track("title", ticket.Title, () => ticket.Rename(command.Title.Value), () => ticket.Title);
            if (command.Description.HasValue)
                changes.Track("description", ticket.Description, () => ticket.ChangeDescription(command.Description.Value), () => ticket.Description);
            if (command.Priority.HasValue)
                changes.Track("priority", ticket.Priority, () => ticket.ChangePriority(command.Priority.Value), () => ticket.Priority);
            if (command.Severity.HasValue)
                changes.Track("severity", ticket.Severity, () => ticket.ChangeSeverity(command.Severity.Value), () => ticket.Severity);
            if (command.StoryPoints.HasValue)
                changes.Track("storyPoints", ticket.StoryPoints, () => ticket.ChangeStoryPoints(command.StoryPoints.Value), () => ticket.StoryPoints);
            if (command.Version.HasValue)
                changes.Track("version", ticket.Version, () => ticket.ChangeVersion(command.Version.Value), () => ticket.Version);
            if (command.Labels.HasValue || command.AddLabels is not null || command.RemoveLabels is not null)
                changes.TrackList("labels", ticket.Labels, () =>
                {
                    if (command.Labels.HasValue)
                        ticket.ReplaceLabels(command.Labels.Value);
                    if (command.AddLabels is not null || command.RemoveLabels is not null)
                        ticket.EditLabels(command.AddLabels, command.RemoveLabels);
                }, () => ticket.Labels);

            await ApplyHierarchyAsync(command, ticket, target, changes, cancellationToken);
            await ApplyStatusAsync(command, ticket, target, changes, now, cancellationToken);

            if (command.Assignee.HasValue)
            {
                var assignee = command.Assignee.Value is { } reference
                    ? await TicketUsers.AssigneeAsync(db, currentUser, target.Grant, reference, cancellationToken)
                    : (Guid?)null;
                changes.Track("assignee", ticket.AssigneeId, () => ticket.AssignTo(assignee), () => ticket.AssigneeId);
            }
            if (command.Reporter.HasValue)
            {
                var reporter = await TicketUsers.ReporterAsync(db, currentUser, command.Reporter.Value, cancellationToken);
                changes.Track("reporter", ticket.ReporterId, () => ticket.ChangeReporter(reporter), () => ticket.ReporterId);
            }

            if (changes.Any)
                ticket.Touch(now);
            await db.SaveChangesAsync(cancellationToken);
            return changes.Any;
        }

        private async Task ApplyHierarchyAsync(Command command, Ticket ticket, TicketTarget target, Changes changes, CancellationToken cancellationToken)
        {
            var oldParentId = ticket.ParentId;
            var oldType = ticket.Type;
            Guid? newParentId = null;
            if (command.ParentKey.HasValue && command.ParentKey.Value is { } parentKey)
                newParentId = (await TicketLookup.ReadAsync(db, access, parentKey, cancellationToken)).Id;

            if (command.ParentKey.HasValue && newParentId is null)
                ticket.ClearParent();
            if (command.Type.HasValue)
                ticket.ChangeType(command.Type.Value);
            if (newParentId is { } parentId && parentId != oldParentId)
                await TicketTree.SetParentAsync(db, ticket, parentId, cancellationToken);

            changes.Record("type", oldType, ticket.Type);
            if (oldParentId != ticket.ParentId)
            {
                var keys = await db.Tickets
                    .Where(t => t.Id == oldParentId || t.Id == ticket.ParentId)
                    .Select(t => new { t.Id, t.Number })
                    .ToDictionaryAsync(t => t.Id, t => HumanKeys.Ticket(target.Grant.ProjectKey, t.Number), cancellationToken);
                changes.Record(
                    "parent",
                    oldParentId is { } o ? keys.GetValueOrDefault(o) : null,
                    ticket.ParentId is { } n ? keys.GetValueOrDefault(n) : null);
            }
        }

        private async Task ApplyStatusAsync(Command command, Ticket ticket, TicketTarget target, Changes changes, DateTimeOffset now, CancellationToken cancellationToken)
        {
            if (!command.Status.HasValue && !command.Resolution.HasValue)
                return;

            var oldStatus = ticket.Status;
            var oldResolution = ticket.Resolution;
            var status = command.Status.HasValue ? command.Status.Value : ticket.Status;
            var resolution = command.Resolution.HasValue ? command.Resolution.Value : null;
            var change = ticket.ChangeStatus(status, resolution, now);
            changes.Record("status", oldStatus, ticket.Status);
            changes.Record("resolution", oldResolution, ticket.Resolution);

            if (change.LeavesDone && ticket.BoardId is { } boardId
                && await db.Boards.AnyAsync(b => b.Id == boardId && b.ArchivedAt != null, cancellationToken))
            {
                var rank = await ranker.TopAsync(RankContainer.Backlog(target.ProjectId), [ticket.Id], cancellationToken);
                ticket.MoveToBacklog(rank);
                activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, target.ProjectId, BoardRelocation.MovedAction, BoardRelocation.MovedField, (Guid?)boardId, (Guid?)null);
            }
        }
    }

    private sealed class Changes(IActivityLog activity, Guid ticketId, Guid projectId)
    {
        public bool Any { get; private set; }

        public void Track<T>(string field, T before, Action apply, Func<T> after)
        {
            apply();
            Record(field, before, after());
        }

        public void TrackList(string field, IReadOnlyList<string> before, Action apply, Func<IReadOnlyList<string>> after)
        {
            var snapshot = before.ToList();
            apply();
            var current = after();
            if (snapshot.SequenceEqual(current, StringComparer.Ordinal))
                return;
            Any = true;
            activity.RecordChange(ActivityEntityType.Ticket, ticketId, projectId, FieldChanged, field, snapshot, current.ToList());
        }

        public void Record<T>(string field, T before, T after)
        {
            if (EqualityComparer<T>.Default.Equals(before, after))
                return;
            Any = true;
            activity.RecordChange(ActivityEntityType.Ticket, ticketId, projectId, FieldChanged, field, before, after);
        }
    }
}
