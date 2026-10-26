using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Tickets;

/// <summary>
/// Quick lookup of a project's tickets by key or title for pickers (parent, link target): at most 20 non-deleted
/// tickets, exact key match first, then most recently updated. Full search with every filter is the search slice.
/// </summary>
public static class FindTickets
{
    public const int MaxResults = 20;

    public sealed record Query(string ProjectKeyOrId, string? Text = null, IReadOnlyList<TicketType>? Types = null, int? Limit = null);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<TicketRefDto>>
    {
        public async Task<IReadOnlyList<TicketRefDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            var projectId = grant.ProjectId;
            var tickets = db.Tickets.AsNoTracking().Where(t => t.ProjectId == projectId && t.DeletedAt == null);
            if (request.Types is { Count: > 0 } types)
                tickets = tickets.Where(t => types.Contains(t.Type));

            var number = -1;
            if (!string.IsNullOrWhiteSpace(request.Text))
            {
                var text = request.Text.Trim();
                var pattern = SqlLike.Contains(text);
                if (HumanKeys.TryParseTicket(text, out _, out var n) || int.TryParse(text, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out n))
                    number = n;
                var exact = number;
                tickets = tickets.Where(t => t.Number == exact || EF.Functions.ILike(t.Title, pattern));
            }

            var limit = Math.Clamp(request.Limit ?? MaxResults, 1, MaxResults);
            var rows = await (
                    from t in tickets
                    from a in db.Users.Where(u => u.Id == t.AssigneeId).DefaultIfEmpty()
                    orderby t.Number == number descending, t.UpdatedAt descending
                    select new
                    {
                        t.Id, t.Number, t.Title, t.Type, t.Status, t.Priority,
                        AssigneeId = (Guid?)a.Id, AssigneeEmail = a.Email, AssigneeName = a.DisplayName, AssigneeActive = (bool?)a.IsActive,
                    })
                .Take(limit)
                .ToListAsync(cancellationToken);

            return [.. rows.Select(r => new TicketRefDto(
                r.Id, HumanKeys.Ticket(grant.ProjectKey, r.Number), r.Title, r.Type, r.Status, r.Priority,
                TicketQueries.User(r.AssigneeId, r.AssigneeEmail, r.AssigneeName, r.AssigneeActive)))];
        }
    }
}
