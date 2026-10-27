using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Search;

/// <summary>
/// The command palette lookup (spec 6.8, I-04): an exact ticket, test case, regression session or doc key comes first,
/// then up to 10 tickets whose title matches, then up to 5 docs by relevance with a snippet (refinement 1.10), across
/// readable projects only. A scope (the palette's <c>t:</c> and <c>p:</c> prefixes) keeps only tickets or only docs and lists up to 20 of them.
/// </summary>
public static class QuickJump
{
    public const int MaxTitleMatches = 10;
    public const int MaxDocMatches = 5;
    public const int MaxScopedMatches = 20;
    private const int MinTrigramLength = 3;

    public sealed record Query(string? Text, QuickJumpScope? Scope = null);

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
            var scope = request.Scope;
            var exact = await ExactKeyAsync(readable, text, cancellationToken);
            if (exact is not null && !InScope(exact.Kind, scope))
                exact = null;
            if (exact is not null)
                items.Add(exact);

            if (scope != QuickJumpScope.Docs)
                items.AddRange(await TitleMatchesAsync(readable, text, exact?.Id, scope is null ? MaxTitleMatches : MaxScopedMatches, cancellationToken));
            if (scope != QuickJumpScope.Tickets)
                items.AddRange(await DocsAsync(text, exact?.Kind == QuickJumpKind.Doc ? exact.Id : null, scope is null ? MaxDocMatches : MaxScopedMatches, cancellationToken));
            return items;
        }

        private static bool InScope(QuickJumpKind kind, QuickJumpScope? scope) => scope switch
        {
            QuickJumpScope.Tickets => kind == QuickJumpKind.Ticket,
            QuickJumpScope.Docs => kind == QuickJumpKind.Doc,
            _ => true,
        };

        private async Task<IEnumerable<QuickJumpItem>> TitleMatchesAsync(
            IQueryable<Domain.Projects.Project> readable, string text, Guid? exactId, int limit, CancellationToken cancellationToken)
        {
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
                .Take(limit)
                .ToListAsync(cancellationToken);

            return titleMatches.Select(t =>
            {
                var key = HumanKeys.Ticket(t.ProjectKey, t.Number);
                return new QuickJumpItem(QuickJumpKind.Ticket, t.Id, key, t.Title, t.ProjectKey, TicketQueries.Url(key), t.Type, t.Status.ToString());
            });
        }

        private async Task<IEnumerable<QuickJumpItem>> DocsAsync(string text, Guid? exactId, int limit, CancellationToken cancellationToken)
        {
            var search = new DocSearchQuery(db, access);
            var scope = await search.BuildAsync(new DocSearchCriteria { Text = text }, cancellationToken);
            var ids = await DocSearchQuery.ByRelevance(scope).Take(limit + 1).ToListAsync(cancellationToken);
            var docs = await search.ItemsAsync([.. ids.Where(id => id != exactId).Take(limit)], scope.Text, cancellationToken);
            return docs.Select(Doc);
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

            if (HumanKeys.TryParseDoc(text, out projectKey, out number))
            {
                var key = HumanKeys.Doc(projectKey, number);
                var docId = await (
                        from n in db.DocNodes.AsNoTracking()
                        join p in readable on n.ProjectId equals p.Id
                        where p.Key == projectKey && n.Number == number && n.DeletedAt == null
                        select (Guid?)n.Id)
                    .SingleOrDefaultAsync(cancellationToken);
                if (docId is null)
                    return null;
                var doc = await new DocSearchQuery(db, access).ItemsAsync([docId.Value], null, cancellationToken);
                return doc.Count == 0 ? null : Doc(doc[0]) with { Snippet = null };
            }

            return null;
        }

        private static QuickJumpItem Doc(DocSearchItemDto doc) =>
            new(QuickJumpKind.Doc, doc.Id, doc.Key, doc.Title, doc.ProjectKey, doc.Url, null, null, doc.Kind, doc.DiagramFormat, doc.FolderPath, doc.Snippet);
    }
}

public enum QuickJumpKind
{
    Ticket = 1,
    TestCase = 2,
    RegressionSession = 3,
    Doc = 4,
}

/// <summary>Narrows quick jump to one kind of result: only tickets (exact ticket key, title matches) or only docs.</summary>
public enum QuickJumpScope
{
    Tickets = 1,
    Docs = 2,
}

/// <param name="Url">The SPA path that opens the item.</param>
/// <param name="TicketType">Set for tickets only.</param>
/// <param name="Status">The item's status enum name (ticket, test case or session status); null for docs.</param>
/// <param name="DocKind">Set for docs only, like <paramref name="DiagramFormat"/>.</param>
/// <param name="FolderPath">Docs only: the path of the folder holding the doc (empty at the project root).</param>
/// <param name="Snippet">Docs only: plain text around the match with highlight ranges; null for an exact key and for folders.</param>
public sealed record QuickJumpItem(
    QuickJumpKind Kind,
    Guid Id,
    string Key,
    string Title,
    string ProjectKey,
    string Url,
    TicketType? TicketType,
    string? Status,
    DocKind? DocKind = null,
    DiagramFormat? DiagramFormat = null,
    string? FolderPath = null,
    DocSnippetDto? Snippet = null);

/// <summary>SPA paths of items owned by other slices (agreed with the testing slice).</summary>
public static class SearchUrls
{
    public static string TestCase(string projectKey, string testCaseKey) => $"/projects/{projectKey}/test-cases/{testCaseKey}";

    public static string Regression(string projectKey, string sessionKey) => $"/projects/{projectKey}/regressions/{sessionKey}";

    public static string RegressionItem(string projectKey, string sessionKey, string testCaseKey) =>
        $"{Regression(projectKey, sessionKey)}?item={testCaseKey}";
}
