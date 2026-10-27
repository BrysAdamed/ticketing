using System.Globalization;
using Ticketing.Api.Http;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Search;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// Ticket search, CSV export, docs search (refinement 1.10), quick jump and My work (spec 6.8). Search filters use the query format of
/// <c>docs/architecture/search-url-format.md</c>, the same string the SPA keeps in its <c>/search</c> URL.
/// </summary>
public sealed class SearchEndpoints : IEndpointModule
{
    private const string FilterHelp =
        "Filters (all optional, lists comma-separated): project, q, type, status, category, priority, severity (incl. none), assignee, assigneeNot " +
        "(me, unassigned, id or email), reporter, label (all of), version (none = no version), parent, location (backlog, board, board id), " +
        "createdFrom/To, updatedFrom/To, resolvedFrom/To (date or UTC timestamp), fromRegression, watching (tickets I watch); sort (updated, created, priority, key, rank) and order (asc, desc). " +
        "See docs/architecture/search-url-format.md.";

    private const string DocFilterHelp =
        "Filters (all optional, lists comma-separated): project, q (web search syntax, partial title words, or a doc key), kind (Folder, Page, Diagram), " +
        "folder (folder key or id: its whole subtree), mentions (ticket key or id), updatedFrom/To (date or UTC timestamp); sort (relevance, the default " +
        "with q: at most 100, no cursor; updated, the default without q: newest first, keyset cursor). Each item has a plain-text snippet with highlight " +
        "ranges. See docs/architecture/search-url-format.md.";

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var search = api.MapGroup("/tickets/search").WithTags("Search");

        search.MapGet("", async (HttpRequest request, int? limit, string? cursor, SearchTickets.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new SearchTickets.Query(Criteria(request), new PageRequest(limit, cursor)), ct)))
            .WithSummary("Searches tickets across readable projects; total is counted (up to 1000) on the first page.")
            .WithDescription(FilterHelp)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        search.MapGet("/export.csv", async (HttpRequest request, ExportTickets.Handler handler, IClock clock, CancellationToken ct) =>
            {
                var rows = await handler.HandleAsync(new ExportTickets.Query(Criteria(request)), ct);
                var fileName = string.Create(CultureInfo.InvariantCulture, $"tickets-{clock.Now:yyyy-MM-dd}.csv");
                return TypedResults.Stream(stream => WriteCsvAsync(stream, rows, ct), "text/csv; charset=utf-8", fileName);
            })
            .WithSummary("The search result as CSV (at most 10 000 rows, same filters and sort), streamed.")
            .WithDescription(FilterHelp)
            .Produces(StatusCodes.Status200OK, contentType: "text/csv")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        api.MapGet("/docs/search", async (HttpRequest request, int? limit, string? cursor, SearchDocs.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new SearchDocs.Query(DocSearchQueryParser.Parse(Parameters(request)), new PageRequest(limit, cursor)), ct)))
            .WithTags("Docs")
            .WithSummary("Searches docs across readable projects: title, latest published content and Canvas labels; drafts and deleted docs never match.")
            .WithDescription(DocFilterHelp)
            .ProducesProblem(StatusCodes.Status400BadRequest);

        api.MapGet("/quick-jump", async (string? q, QuickJumpScope? scope, QuickJump.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new QuickJump.Query(q, scope), ct)))
            .WithTags("Search")
            .WithSummary("Command palette lookup: an exact ticket, test case (KEY-TC-n), session (KEY-R-n) or doc (KEY-D-n) key first, then up to 10 tickets by title, then up to 5 docs with a snippet.")
            .WithDescription("scope=Tickets keeps only tickets (an exact ticket key, then up to 20 by title); scope=Docs only docs (an exact doc key, then up to 20 by relevance).")
            .ProducesProblem(StatusCodes.Status400BadRequest);

        api.MapGet("/me/work", async (GetMyWork.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetMyWork.Query(), ct)))
            .WithTags("Search")
            .WithSummary("Open tickets assigned to me grouped by project (at most 500), my waiting regression items, and open tickets I watch (at most 100).");
    }


    private static TicketSearchCriteria Criteria(HttpRequest request) => SearchQueryParser.Parse(Parameters(request));

    private static Dictionary<string, IReadOnlyList<string?>> Parameters(HttpRequest request) =>
        request.Query.ToDictionary(q => q.Key, q => (IReadOnlyList<string?>)q.Value.ToArray(), StringComparer.Ordinal);

    private static async Task WriteCsvAsync(Stream stream, IAsyncEnumerable<TicketExportRow> rows, CancellationToken ct)
    {
        await using var csv = new Csv(stream);
        await csv.WriteRowAsync(
            "Key", "Project", "Project name", "Title", "Type", "Status", "Resolution", "Priority", "Severity", "Story points", "Version", "Labels",
            "Parent", "Assignee email", "Assignee", "Reporter email", "Reporter", "Location", "Created", "Updated", "Status changed", "Resolved",
            "Description");
        await foreach (var r in rows.WithCancellation(ct))
        {
            await csv.WriteRowAsync(
                r.Key, r.ProjectKey, r.ProjectName, r.Title, r.Type.ToString(), r.Status.ToString(), r.Resolution?.ToString(), r.Priority.ToString(),
                r.Severity?.ToString(), r.StoryPoints?.ToString(CultureInfo.InvariantCulture), r.Version, string.Join(';', r.Labels), r.ParentKey,
                r.AssigneeEmail, r.AssigneeName, r.ReporterEmail, r.ReporterName, r.Location, Csv.Date(r.CreatedAt), Csv.Date(r.UpdatedAt),
                Csv.Date(r.StatusChangedAt), Csv.Date(r.ResolvedAt), r.Description);
        }
    }
}
