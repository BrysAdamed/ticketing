using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>One row of the sort key space; every search query is ordered and paged over this projection.</summary>
public sealed record TicketSearchRow
{
    public required Guid Id { get; init; }

    public required string ProjectKey { get; init; }

    public required int Number { get; init; }

    public required DateTimeOffset UpdatedAt { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required Priority Priority { get; init; }

    public required string Rank { get; init; }
}

/// <summary>
/// Turns <see cref="TicketSearchCriteria"/> into a query over the caller's readable, non-deleted tickets. Every reference
/// (project, user, parent) is resolved against what the caller may read, so an unreadable reference matches nothing
/// instead of failing, and results never depend on private data (spec 6.5, 10).
/// </summary>
internal sealed class TicketSearchQuery(ITicketingDbContext db, IProjectAccess access, ICurrentUser currentUser)
{
    private const int MinTrigramLength = 3;

    public async Task<IQueryable<TicketSearchRow>> BuildAsync(TicketSearchCriteria criteria, CancellationToken cancellationToken)
    {
        var readable = access.ReadableProjects().AsNoTracking();
        if (criteria.ProjectKeys.Count > 0)
        {
            var keys = criteria.ProjectKeys;
            readable = readable.Where(p => keys.Contains(p.Key));
        }
        var projects = await readable.Select(p => new { p.Id, p.Key }).ToListAsync(cancellationToken);
        var projectIds = projects.Select(p => p.Id).ToList();

        var tickets = db.Tickets.AsNoTracking().Where(t => t.DeletedAt == null && projectIds.Contains(t.ProjectId));
        tickets = ApplyText(tickets, criteria.Text, projects.ToDictionary(p => p.Key, p => p.Id, StringComparer.Ordinal));
        tickets = ApplyEnums(tickets, criteria);
        tickets = await ApplyUsersAsync(tickets, criteria, cancellationToken);
        tickets = ApplyLabelsAndVersion(tickets, criteria);
        tickets = await ApplyParentAsync(tickets, criteria.Parent, projectIds, cancellationToken);
        tickets = ApplyLocation(tickets, criteria.Location);
        tickets = ApplyRange(tickets, criteria.Created, t => t.CreatedAt);
        tickets = ApplyRange(tickets, criteria.Updated, t => t.UpdatedAt);
        tickets = ApplyResolved(tickets, criteria.Resolved);
        if (criteria.FromRegression)
            tickets = tickets.Where(t => db.RegressionSessionItems.Any(i => i.BugTicketId == t.Id));

        return from t in tickets
               join p in db.Projects on t.ProjectId equals p.Id
               select new TicketSearchRow
               {
                   Id = t.Id, ProjectKey = p.Key, Number = t.Number, UpdatedAt = t.UpdatedAt, CreatedAt = t.CreatedAt, Priority = t.Priority, Rank = t.Rank,
               };
    }

    private static IQueryable<Ticket> ApplyText(IQueryable<Ticket> tickets, string? text, IReadOnlyDictionary<string, Guid> projectIdsByKey)
    {
        if (string.IsNullOrWhiteSpace(text))
            return tickets;
        var query = text.Trim();
        var keyProjectId = Guid.Empty;
        var keyNumber = -1;
        if (HumanKeys.TryParseTicket(query, out var projectKey, out var number) && projectIdsByKey.TryGetValue(projectKey, out var projectId))
        {
            keyProjectId = projectId;
            keyNumber = number;
        }

        var vector = tickets.Where(t =>
            EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, query)));
        var pattern = SqlLike.Contains(query);
        return (query.Length >= MinTrigramLength, keyNumber > 0) switch
        {
            (true, true) => tickets.Where(t =>
                EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, query))
                || EF.Functions.ILike(t.Title, pattern)
                || (t.ProjectId == keyProjectId && t.Number == keyNumber)),
            (true, false) => tickets.Where(t =>
                EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, query))
                || EF.Functions.ILike(t.Title, pattern)),
            _ => vector,
        };
    }
    private static IQueryable<Ticket> ApplyEnums(IQueryable<Ticket> tickets, TicketSearchCriteria criteria)
    {
        if (criteria.Types.Count > 0)
        {
            var types = criteria.Types;
            tickets = tickets.Where(t => types.Contains(t.Type));
        }
        if (criteria.Statuses.Count > 0)
        {
            var statuses = criteria.Statuses;
            tickets = tickets.Where(t => statuses.Contains(t.Status));
        }
        if (criteria.Categories.Count > 0)
        {
            var categoryStatuses = Enum.GetValues<TicketStatus>().Where(s => criteria.Categories.Contains(s.Category())).ToList();
            tickets = tickets.Where(t => categoryStatuses.Contains(t.Status));
        }
        if (criteria.Priorities.Count > 0)
        {
            var priorities = criteria.Priorities;
            tickets = tickets.Where(t => priorities.Contains(t.Priority));
        }
        if (criteria.Severities.Count > 0 || criteria.SeverityNone)
        {
            var severities = criteria.Severities.Select(s => (Severity?)s).ToList();
            var none = criteria.SeverityNone;
            tickets = tickets.Where(t => severities.Contains(t.Severity) || (none && t.Severity == null));
        }
        return tickets;
    }

    private async Task<IQueryable<Ticket>> ApplyUsersAsync(IQueryable<Ticket> tickets, TicketSearchCriteria criteria, CancellationToken cancellationToken)
    {
        if (criteria.Assignees.Count > 0)
        {
            var (ids, unassigned) = await ResolveUsersAsync(criteria.Assignees, cancellationToken);
            tickets = tickets.Where(t => (t.AssigneeId != null && ids.Contains(t.AssigneeId.Value)) || (unassigned && t.AssigneeId == null));
        }
        if (criteria.ExcludedAssignees.Count > 0)
        {
            var (ids, unassigned) = await ResolveUsersAsync(criteria.ExcludedAssignees, cancellationToken);
            tickets = tickets.Where(t => t.AssigneeId == null ? !unassigned : !ids.Contains(t.AssigneeId.Value));
        }
        if (criteria.Reporters.Count > 0)
        {
            var (ids, _) = await ResolveUsersAsync(criteria.Reporters, cancellationToken);
            tickets = tickets.Where(t => ids.Contains(t.ReporterId));
        }
        return tickets;
    }

    private async Task<(List<Guid> Ids, bool Unassigned)> ResolveUsersAsync(IReadOnlyList<string> references, CancellationToken cancellationToken)
    {
        var ids = new List<Guid>();
        var emails = new List<string>();
        var unassigned = false;
        foreach (var reference in references)
        {
            if (reference == SearchQueryParser.Me)
                ids.Add(currentUser.Id);
            else if (reference == SearchQueryParser.Unassigned)
                unassigned = true;
            else if (Guid.TryParse(reference, out var id))
                ids.Add(id);
            else
                emails.Add(reference);
        }
        if (emails.Count > 0)
            ids.AddRange(await db.Users.AsNoTracking().Where(u => emails.Contains(u.Email)).Select(u => u.Id).ToListAsync(cancellationToken));
        return (ids, unassigned);
    }

    private static IQueryable<Ticket> ApplyLabelsAndVersion(IQueryable<Ticket> tickets, TicketSearchCriteria criteria)
    {
        if (criteria.Labels.Count > 0)
        {
            var labels = criteria.Labels.ToList();
            tickets = tickets.Where(t => labels.All(l => t.Labels.Contains(l)));
        }
        if (criteria.VersionNone)
        {
            tickets = tickets.Where(t => t.Version == null);
        }
        else if (criteria.Version is not null)
        {
            var version = criteria.Version;
            tickets = tickets.Where(t => t.Version == version);
        }
        return tickets;
    }

    private async Task<IQueryable<Ticket>> ApplyParentAsync(
        IQueryable<Ticket> tickets, string? parent, List<Guid> projectIds, CancellationToken cancellationToken)
    {
        if (parent is null)
            return tickets;
        IQueryable<Ticket> parents;
        if (Guid.TryParse(parent, out var parentId))
        {
            parents = db.Tickets.Where(t => t.Id == parentId);
        }
        else
        {
            HumanKeys.TryParseTicket(parent, out var projectKey, out var number);
            parents = db.Tickets.Where(t => t.Number == number && db.Projects.Any(p => p.Id == t.ProjectId && p.Key == projectKey));
        }
        var resolved = await parents.AsNoTracking()
            .Where(t => t.DeletedAt == null && projectIds.Contains(t.ProjectId))
            .Select(t => (Guid?)t.Id)
            .FirstOrDefaultAsync(cancellationToken);
        var id = resolved ?? Guid.Empty;
        return tickets.Where(t => t.ParentId == id);
    }

    private static IQueryable<Ticket> ApplyLocation(IQueryable<Ticket> tickets, SearchLocation? location) => location?.Kind switch
    {
        SearchLocationKind.Backlog => tickets.Where(t => t.BoardId == null),
        SearchLocationKind.AnyBoard => tickets.Where(t => t.BoardId != null),
        SearchLocationKind.Board => tickets.Where(t => t.BoardId == location.BoardId),
        _ => tickets,
    };

    private static IQueryable<Ticket> ApplyRange(IQueryable<Ticket> tickets, DateRange range, Expression<Func<Ticket, DateTimeOffset>> field)
    {
        if (range.From is { } from)
            tickets = tickets.Where(Compare(field, from, ExpressionType.GreaterThanOrEqual));
        if (range.To is { } to)
            tickets = tickets.Where(Compare(field, to, ExpressionType.LessThan));
        return tickets;
    }

    private static IQueryable<Ticket> ApplyResolved(IQueryable<Ticket> tickets, DateRange range)
    {
        if (range.From is { } from)
            tickets = tickets.Where(t => t.ResolvedAt != null && t.ResolvedAt >= from);
        if (range.To is { } to)
            tickets = tickets.Where(t => t.ResolvedAt != null && t.ResolvedAt < to);
        return tickets;
    }

    private static Expression<Func<Ticket, bool>> Compare(Expression<Func<Ticket, DateTimeOffset>> field, DateTimeOffset value, ExpressionType comparison)
    {
        Expression<Func<DateTimeOffset>> parameter = () => value;
        return Expression.Lambda<Func<Ticket, bool>>(
            Expression.MakeBinary(comparison, field.Body, parameter.Body), field.Parameters);
    }
}
