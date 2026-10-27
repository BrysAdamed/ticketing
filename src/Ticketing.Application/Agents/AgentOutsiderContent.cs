using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.TestCases;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Agents;

/// <summary>
/// The newest text a delegated agent reads over MCP that came from outside the team (D-100, D-104, D-106): title or
/// description writes (creation included), non-deleted comments (at their last edit) and attachments on the ticket and on
/// its parent, children and linked tickets that the caller can read, plus creation and text edits of the ticket's test
/// cases. Outside means neither an Admin nor an Owner or Member of the project the text was written in, so Viewers and
/// former members count as outside. Private projects are checked too, which keeps text written while a project was public
/// flagged, and a later insider write never clears it. At most five indexed queries, however many tickets are related.
/// </summary>
internal static class AgentOutsiderContent
{
    private static readonly string[] TestCaseTextFields = ["title", "preconditions", "steps", "expectedResult", "automationReference"];

    /// <summary>What the warning names: the source, its author and time, the project the author is not a writer of, and the related ticket or test case.</summary>
    public sealed record Found(AgentPromptContentSource Source, Guid AuthorId, DateTimeOffset At, string ProjectKey, string? ItemKey);

    private sealed record Hit(AgentPromptContentSource Source, Guid AuthorId, DateTimeOffset At, Guid? TicketId = null, int? TestCaseNumber = null);

    public static async Task<Found?> FindAsync(
        ITicketingDbContext db, IProjectAccess access, TicketTarget ticket, Guid? parentId, CancellationToken cancellationToken)
    {
        var admins = db.Users.Where(u => u.GlobalRole == GlobalRole.Admin).Select(u => u.Id);
        var writers = db.ProjectMembers.Where(m => m.Role != ProjectRole.Viewer);
        var linked = db.TicketLinks.Where(l => l.SourceTicketId == ticket.Id).Select(l => l.TargetTicketId)
            .Concat(db.TicketLinks.Where(l => l.TargetTicketId == ticket.Id).Select(l => l.SourceTicketId));
        var readable = access.ReadableProjects().Select(p => p.Id);
        var scope = db.Tickets.Where(t => t.DeletedAt == null && readable.Contains(t.ProjectId)
            && (t.Id == ticket.Id || t.Id == parentId || t.ParentId == ticket.Id || linked.Contains(t.Id)));

        var text = await (
                from a in db.ActivityEntries
                join t in scope on a.EntityId equals t.Id
                where a.EntityType == ActivityEntityType.Ticket
                    && (a.Action == CreateTicket.Action || (a.Action == UpdateTicket.FieldChanged && (a.Field == "title" || a.Field == "description")))
                    && a.ActorId != null
                    && !admins.Contains(a.ActorId.Value)
                    && !writers.Any(m => m.ProjectId == t.ProjectId && m.UserId == a.ActorId.Value)
                orderby a.OccurredAt descending
                select new { AuthorId = a.ActorId!.Value, a.Field, a.OccurredAt, TicketId = t.Id })
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);
        var comment = await (
                from c in db.Comments
                join t in scope on c.TicketId equals t.Id
                where c.DeletedAt == null
                    && !admins.Contains(c.AuthorId)
                    && !writers.Any(m => m.ProjectId == t.ProjectId && m.UserId == c.AuthorId)
                orderby (c.EditedAt ?? c.CreatedAt) descending
                select new { c.AuthorId, At = c.EditedAt ?? c.CreatedAt, TicketId = t.Id })
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);
        var attachment = await (
                from a in db.Attachments
                join t in scope on a.TicketId equals t.Id
                where !admins.Contains(a.UploadedById)
                    && !writers.Any(m => m.ProjectId == t.ProjectId && m.UserId == a.UploadedById)
                orderby a.UploadedAt descending
                select new { a.UploadedById, a.UploadedAt, TicketId = t.Id })
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);
        var testCase = await (
                from a in db.ActivityEntries
                join c in db.TestCases on a.EntityId equals c.Id
                where a.EntityType == ActivityEntityType.TestCase
                    && c.TicketId == ticket.Id
                    && c.ArchivedAt == null
                    && (a.Action == CreateTestCase.Action
                        || (a.Action == UpdateTestCase.FieldChanged && a.Field != null && TestCaseTextFields.Contains(a.Field)))
                    && a.ActorId != null
                    && !admins.Contains(a.ActorId.Value)
                    && !writers.Any(m => m.ProjectId == c.ProjectId && m.UserId == a.ActorId.Value)
                orderby a.OccurredAt descending
                select new { AuthorId = a.ActorId!.Value, a.OccurredAt, c.Number })
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);

        var hits = new List<Hit>(4);
        if (text is not null)
            hits.Add(new Hit(
                text.Field == "title" ? AgentPromptContentSource.Title : AgentPromptContentSource.Description, text.AuthorId, text.OccurredAt, text.TicketId));
        if (comment is not null)
            hits.Add(new Hit(AgentPromptContentSource.Comment, comment.AuthorId, comment.At, comment.TicketId));
        if (attachment is not null)
            hits.Add(new Hit(AgentPromptContentSource.Attachment, attachment.UploadedById, attachment.UploadedAt, attachment.TicketId));
        if (testCase is not null)
            hits.Add(new Hit(AgentPromptContentSource.TestCase, testCase.AuthorId, testCase.OccurredAt, TestCaseNumber: testCase.Number));

        var newest = hits.MaxBy(h => h.At);
        return newest switch
        {
            null => null,
            { TestCaseNumber: { } number } => new Found(
                newest.Source, newest.AuthorId, newest.At, ticket.Grant.ProjectKey, HumanKeys.TestCase(ticket.Grant.ProjectKey, number)),
            { TicketId: { } id } when id != ticket.Id => await RelatedAsync(db, newest, id, cancellationToken),
            _ => new Found(newest.Source, newest.AuthorId, newest.At, ticket.Grant.ProjectKey, null),
        };
    }

    private static async Task<Found> RelatedAsync(ITicketingDbContext db, Hit hit, Guid ticketId, CancellationToken cancellationToken)
    {
        var related = await (
                from t in db.Tickets
                join p in db.Projects on t.ProjectId equals p.Id
                where t.Id == ticketId
                select new { p.Key, t.Number })
            .SingleAsync(cancellationToken);
        return new Found(AgentPromptContentSource.RelatedTicket, hit.AuthorId, hit.At, related.Key, HumanKeys.Ticket(related.Key, related.Number));
    }
}
