using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Boards;
using Ticketing.Application.Comments;
using Ticketing.Application.Docs;
using Ticketing.Application.Regressions;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>Something a write did that collaboration rules react to, read from its activity entry (D-93).</summary>
public abstract record CollaborationEvent(Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt);

public abstract record TicketEvent(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt)
    : CollaborationEvent(ProjectId, ActorId, OccurredAt);

public sealed record TicketCreated(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid ReporterId, Guid? AssigneeId, string? Description)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record AssigneeChanged(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid? From, Guid? To)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record StatusChanged(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, TicketStatus? From, TicketStatus? To)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record PriorityChanged(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Priority? From, Priority? To)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record DescriptionChanged(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, string? From, string? To)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record CommentAdded(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid CommentId, string? Body)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record CommentEdited(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid CommentId, string? From, string? To)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record TicketMoved(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid? FromBoardId, Guid? ToBoardId)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public sealed record TicketDeleted(Guid TicketId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt)
    : TicketEvent(TicketId, ProjectId, ActorId, OccurredAt);

public abstract record DocEvent(Guid DocNodeId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt)
    : CollaborationEvent(ProjectId, ActorId, OccurredAt);

/// <summary>
/// A page or diagram was created (folders are skipped): its creator starts watching it (D-162). <see cref="Content"/> is the
/// content of a new page, whose mentions notify (D-164); null for diagrams and duplicates.
/// </summary>
public sealed record DocCreated(Guid DocNodeId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, string? Content)
    : DocEvent(DocNodeId, ProjectId, ActorId, OccurredAt);

/// <summary>A new version of a page was published (not restored): users it newly mentions are notified (D-164).</summary>
public sealed record DocPublished(Guid DocNodeId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, string? From, string? To)
    : DocEvent(DocNodeId, ProjectId, ActorId, OccurredAt);

/// <summary>A comment added to a page or diagram (docs refinement D12): the doc's watchers are notified (D-162), mentioned users too (D-163).</summary>
public sealed record DocCommentAdded(Guid DocNodeId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid CommentId, string? Body)
    : DocEvent(DocNodeId, ProjectId, ActorId, OccurredAt);

/// <summary>A doc comment edited by its author: users the edit newly mentions are notified (D-163). <see cref="To"/> is read from the comment.</summary>
public sealed record DocCommentEdited(Guid DocNodeId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, Guid CommentId, string? From, string? To)
    : DocEvent(DocNodeId, ProjectId, ActorId, OccurredAt);

public sealed record RegressionItemAssigned(Guid SessionId, Guid ProjectId, Guid? ActorId, DateTimeOffset OccurredAt, string TestCaseKey, Guid? From, Guid? To)
    : CollaborationEvent(ProjectId, ActorId, OccurredAt);

/// <summary>
/// Reads activity entries into <see cref="CollaborationEvent"/>s. Entries other rules do not care about are skipped. New
/// tickets and comments are read from the change tracker (or, when not tracked, in one query each), so reading costs no
/// query per entry.
/// </summary>
public static class CollaborationEvents
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public static async Task<IReadOnlyList<CollaborationEvent>> ReadAsync(
        ITicketingDbContext db, IReadOnlyList<ActivityEntry> entries, CancellationToken cancellationToken)
    {
        var created = await CreatedTicketsAsync(db, entries, cancellationToken);
        var comments = await CommentBodiesAsync(db, entries, cancellationToken);
        var pages = PublishedPages(db, entries);
        var events = new List<CollaborationEvent>(entries.Count);
        foreach (var entry in entries)
        {
            if (entry.ProjectId is not { } projectId)
                continue;
            var e = Read(entry, projectId, created, comments, pages);
            if (e is not null)
                events.Add(e);
        }
        return events;
    }

    private static CollaborationEvent? Read(
        ActivityEntry entry, Guid projectId, IReadOnlyDictionary<Guid, CreatedTicket> created, IReadOnlyDictionary<Guid, string> comments,
        IReadOnlyDictionary<Guid, PageContent> pages)
    {
        var (id, actor, at) = (entry.EntityId, entry.ActorId, entry.OccurredAt);
        if (entry.EntityType == ActivityEntityType.RegressionSession)
        {
            if (entry.Action != RegressionItemWrites.AssignedAction || Parse<ItemAssignment>(entry.NewValue) is not { } assignment)
                return null;
            return new RegressionItemAssigned(id, projectId, actor, at, assignment.TestCaseKey, assignment.From, assignment.To);
        }
        if (entry.EntityType == ActivityEntityType.Doc)
        {
            return entry.Action switch
            {
                CreateDoc.Action when Parse<CreatedDoc>(entry.NewValue) is { Kind: not DocKind.Folder } doc =>
                    new DocCreated(id, projectId, actor, at, doc.DuplicatedFrom is null ? pages.GetValueOrDefault(id)?.To : null),
                DocPublisher.UpdatedAction when pages.TryGetValue(id, out var page) =>
                    new DocPublished(id, projectId, actor, at, page.From, page.To),
                AddDocComment.Action when Parse<CommentBody>(entry.NewValue) is { } docComment =>
                    new DocCommentAdded(id, projectId, actor, at, docComment.CommentId, comments.GetValueOrDefault(docComment.CommentId)),
                UpdateDocComment.Action when Parse<CommentBody>(entry.NewValue) is { } edited =>
                    new DocCommentEdited(id, projectId, actor, at, edited.CommentId, Parse<CommentBody>(entry.OldValue)?.Body, comments.GetValueOrDefault(edited.CommentId)),
                _ => null,
            };
        }
        if (entry.EntityType != ActivityEntityType.Ticket)
            return null;

        return (entry.Action, entry.Field) switch
        {
            (CreateTicket.Action, _) when created.TryGetValue(id, out var t) =>
                new TicketCreated(id, projectId, actor, at, t.ReporterId, t.AssigneeId, t.Description),
            (UpdateTicket.FieldChanged, "assignee") =>
                new AssigneeChanged(id, projectId, actor, at, Parse<Guid?>(entry.OldValue), Parse<Guid?>(entry.NewValue)),
            (UpdateTicket.FieldChanged, "status") =>
                new StatusChanged(id, projectId, actor, at, Parse<TicketStatus?>(entry.OldValue), Parse<TicketStatus?>(entry.NewValue)),
            (UpdateTicket.FieldChanged, "priority") =>
                new PriorityChanged(id, projectId, actor, at, Parse<Priority?>(entry.OldValue), Parse<Priority?>(entry.NewValue)),
            (UpdateTicket.FieldChanged, "description") =>
                new DescriptionChanged(id, projectId, actor, at, Parse<string>(entry.OldValue), Parse<string>(entry.NewValue)),
            (AddComment.Action, _) when Parse<CommentBody>(entry.NewValue) is { } added =>
                new CommentAdded(id, projectId, actor, at, added.CommentId, comments.GetValueOrDefault(added.CommentId)),
            (UpdateComment.Action, _) when Parse<CommentBody>(entry.NewValue) is { } edited =>
                new CommentEdited(id, projectId, actor, at, edited.CommentId, Parse<CommentBody>(entry.OldValue)?.Body, edited.Body),
            (BoardRelocation.MovedAction, BoardRelocation.MovedField) =>
                new TicketMoved(id, projectId, actor, at, Parse<Guid?>(entry.OldValue), Parse<Guid?>(entry.NewValue)),
            (DeleteTicket.Action, _) => new TicketDeleted(id, projectId, actor, at),
            _ => null,
        };
    }

    private static async Task<IReadOnlyDictionary<Guid, CreatedTicket>> CreatedTicketsAsync(
        ITicketingDbContext db, IReadOnlyList<ActivityEntry> entries, CancellationToken cancellationToken)
    {
        var ids = entries
            .Where(e => e.EntityType == ActivityEntityType.Ticket && e.Action == CreateTicket.Action)
            .Select(e => e.EntityId)
            .ToHashSet();
        if (ids.Count == 0)
            return new Dictionary<Guid, CreatedTicket>();

        var result = db.ChangeTracker.Entries<Ticket>()
            .Where(e => ids.Contains(e.Entity.Id))
            .ToDictionary(e => e.Entity.Id, e => new CreatedTicket(e.Entity.ReporterId, e.Entity.AssigneeId, e.Entity.Description));
        var missing = ids.Where(id => !result.ContainsKey(id)).ToList();
        if (missing.Count > 0)
        {
            var rows = await db.Tickets.AsNoTracking()
                .Where(t => missing.Contains(t.Id))
                .Select(t => new { t.Id, t.ReporterId, t.AssigneeId, t.Description })
                .ToListAsync(cancellationToken);
            foreach (var row in rows)
                result[row.Id] = new CreatedTicket(row.ReporterId, row.AssigneeId, row.Description);
        }
        return result;
    }

    /// <summary>
    /// Current bodies of the ticket comments added and the doc comments added or edited by <paramref name="entries"/>, from the
    /// change tracker or, when not tracked, one query.
    /// </summary>
    private static async Task<IReadOnlyDictionary<Guid, string>> CommentBodiesAsync(
        ITicketingDbContext db, IReadOnlyList<ActivityEntry> entries, CancellationToken cancellationToken)
    {
        var ids = entries
            .Where(e => (e.EntityType == ActivityEntityType.Ticket && e.Action == AddComment.Action)
                || (e.EntityType == ActivityEntityType.Doc && e.Action is AddDocComment.Action or UpdateDocComment.Action))
            .Select(e => Parse<CommentBody>(e.NewValue)?.CommentId)
            .OfType<Guid>()
            .ToHashSet();
        if (ids.Count == 0)
            return new Dictionary<Guid, string>();

        var result = db.ChangeTracker.Entries<Comment>()
            .Where(e => ids.Contains(e.Entity.Id))
            .ToDictionary(e => e.Entity.Id, e => e.Entity.Body);
        var missing = ids.Where(id => !result.ContainsKey(id)).ToList();
        if (missing.Count > 0)
        {
            var rows = await db.Comments.AsNoTracking()
                .Where(c => missing.Contains(c.Id))
                .Select(c => new { c.Id, c.Body })
                .ToListAsync(cancellationToken);
            foreach (var row in rows)
                result[row.Id] = row.Body;
        }
        return result;
    }

    /// <summary>
    /// The published and the new content of the pages that <paramref name="entries"/> create or publish, from the change tracker:
    /// the publishing handlers hold the node tracked (and row-locked), so the original value is the content published before.
    /// </summary>
    private static IReadOnlyDictionary<Guid, PageContent> PublishedPages(ITicketingDbContext db, IReadOnlyList<ActivityEntry> entries)
    {
        var ids = entries
            .Where(e => e.EntityType == ActivityEntityType.Doc && e.Action is CreateDoc.Action or DocPublisher.UpdatedAction)
            .Select(e => e.EntityId)
            .ToHashSet();
        if (ids.Count == 0)
            return new Dictionary<Guid, PageContent>();

        return db.ChangeTracker.Entries<DocNode>()
            .Where(e => e.Entity.Kind == DocKind.Page && ids.Contains(e.Entity.Id))
            .ToDictionary(
                e => e.Entity.Id,
                e => new PageContent(
                    e.State == EntityState.Added ? null : e.Property(n => n.Content).OriginalValue,
                    e.Entity.Content));
    }

    private static T? Parse<T>(string? json) => json is null ? default : JsonSerializer.Deserialize<T>(json, Json);

    private sealed record CreatedTicket(Guid ReporterId, Guid? AssigneeId, string? Description);

    private sealed record CommentBody(Guid CommentId, string? Body);

    private sealed record CreatedDoc(DocKind Kind, string? DuplicatedFrom);

    private sealed record PageContent(string? From, string? To);

    private sealed record ItemAssignment(string TestCaseKey, Guid? From, Guid? To);
}
