using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>
/// The command palette lookup (spec 6.8, I-04): an exact ticket, test case or regression session key comes first,
/// then up to 10 tickets whose title matches, across readable projects only.
/// </summary>
public static class QuickJump
{
    public const int MaxTitleMatches = 10;
    private const int MinTrigramLength = 3;

    public sealed record Query(string? Text);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, IReadOnlyList<QuickJumpItem>>
    {
        public async Task<IReadOnlyList<QuickJumpItem>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var text = request.Text?.Trim() ?? string.Empty;
            if (text.Length == 0)
                return [];
            if (text.Length > 200)
                text = text[..200];

            var readable = access.ReadableProjects().AsNoTracking();
            var items = new List<QuickJumpItem>();
            var exact = await ExactKeyAsync(readable, text, cancellationToken);
            if (exact is not null)
                items.Add(exact);

            var exactId = exact?.Id;
            var pattern = SqlLike.Contains(text);
            var useTrigram = text.Length >= MinTrigramLength;
            var titleMatches = await (
                    from t in db.Tickets.AsNoTracking()
                    join p in readable on t.ProjectId equals p.Id
                    where t.DeletedAt == null
                          && t.Id != exactId
                          && (EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, text))
                              || (useTrigram && EF.Functions.ILike(t.Title, pattern)))
                    orderby EF.Functions.ILike(t.Title, SqlLike.StartsWith(text)) descending, t.UpdatedAt descending
                    select new { t.Id, ProjectKey = p.Key, t.Number, t.Title, t.Type, t.Status })
                .Take(MaxTitleMatches)
                .ToListAsync(cancellationToken);

            items.AddRange(titleMatches.Select(t =>
            {
                var key = HumanKeys.Ticket(t.ProjectKey, t.Number);
                return new QuickJumpItem(QuickJumpKind.Ticket, t.Id, key, t.Title, t.ProjectKey, TicketQueries.Url(key), t.Type, t.Status.ToString());
            }));
            return items;
        }

        private async Task<QuickJumpItem?> ExactKeyAsync(IQueryable<Domain.Projects.Project> readable, string text, CancellationToken cancellationToken)
        {
            if (HumanKeys.TryParseTicket(text, out var projectKey, out var number))
            {
                var ticket = await (
                        from t in db.Tickets.AsNoTracking()
                        join p in readable on t.ProjectId equals p.Id
                        where p.Key == projectKey && t.Number == number && t.DeletedAt == null
                        select new { t.Id, t.Title, t.Type, t.Status })
                    .SingleOrDefaultAsync(cancellationToken);
                var key = HumanKeys.Ticket(projectKey, number);
                return ticket is null ? null
                    : new QuickJumpItem(QuickJumpKind.Ticket, ticket.Id, key, ticket.Title, projectKey, TicketQueries.Url(key), ticket.Type, ticket.Status.ToString());
            }

            if (HumanKeys.TryParseTestCase(text, out projectKey, out number))
            {
                var testCase = await (
                        from c in db.TestCases.AsNoTracking()
                        join p in readable on c.ProjectId equals p.Id
                        where p.Key == projectKey && c.Number == number
                        select new { c.Id, c.Title, c.Status })
                    .SingleOrDefaultAsync(cancellationToken);
                var key = HumanKeys.TestCase(projectKey, number);
                return testCase is null ? null
                    : new QuickJumpItem(QuickJumpKind.TestCase, testCase.Id, key, testCase.Title, projectKey, SearchUrls.TestCase(projectKey, key), null, testCase.Status.ToString());
            }

            if (HumanKeys.TryParseRegression(text, out projectKey, out number))
            {
                var session = await (
                        from s in db.RegressionSessions.AsNoTracking()
                        join p in readable on s.ProjectId equals p.Id
                        where p.Key == projectKey && s.Number == number
                        select new { s.Id, s.Name, s.Status })
                    .SingleOrDefaultAsync(cancellationToken);
                var key = HumanKeys.Regression(projectKey, number);
                return session is null ? null
                    : new QuickJumpItem(QuickJumpKind.RegressionSession, session.Id, key, session.Name, projectKey, SearchUrls.Regression(projectKey, key), null, session.Status.ToString());
            }

            return null;
        }
    }
}

public enum QuickJumpKind
{
    Ticket = 1,
    TestCase = 2,
    RegressionSession = 3,
}

/// <param name="Url">The SPA path that opens the item.</param>
/// <param name="TicketType">Set for tickets only.</param>
/// <param name="Status">The item's status enum name (ticket, test case or session status).</param>
public sealed record QuickJumpItem(
    QuickJumpKind Kind, Guid Id, string Key, string Title, string ProjectKey, string Url, TicketType? TicketType, string Status);

/// <summary>SPA paths of items owned by other slices (agreed with the testing slice).</summary>
public static class SearchUrls
{
    public static string TestCase(string projectKey, string testCaseKey) => $"/projects/{projectKey}/test-cases/{testCaseKey}";

    public static string Regression(string projectKey, string sessionKey) => $"/projects/{projectKey}/regressions/{sessionKey}";

    public static string RegressionItem(string projectKey, string sessionKey, string testCaseKey) =>
        $"{Regression(projectKey, sessionKey)}?item={testCaseKey}";
}
