using System.Globalization;
using Ticketing.Api.Http;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Application.Search;

namespace Ticketing.Api.Endpoints;

/// <summary>
/// Ticket search, CSV export, quick jump and My work (spec 6.8). Search filters use the query format of
/// <c>docs/architecture/search-url-format.md</c>, the same string the SPA keeps in its <c>/search</c> URL.
/// </summary>
public sealed class SearchEndpoints : IEndpointModule
{
    private const string FilterHelp =
        "Filters (all optional, lists comma-separated): project, q, type, status, category, priority, severity (incl. none), assignee, assigneeNot " +
        "(me, unassigned, id or email), reporter, label (all of), version (none = no version), parent, location (backlog, board, board id), " +
        "createdFrom/To, updatedFrom/To, resolvedFrom/To (date or UTC timestamp), fromRegression; sort (updated, created, priority, key, rank) and order (asc, desc). " +
        "See docs/architecture/search-url-format.md.";

    public void MapEndpoints(RouteGroupBuilder api)
    {
        var search = api.MapGroup("/tickets/search").WithTags("Search");

        search.MapGet("", async (HttpRequest request, int? limit, string? cursor, SearchTickets.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new SearchTickets.Query(Criteria(request), new PageRequest(limit, cursor)), ct)))
            .WithSummary("Searches tickets across readable projects; total is counted (up to 10 000) on the first page.")
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

        api.MapGet("/quick-jump", async (string? q, QuickJump.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new QuickJump.Query(q), ct)))
            .WithTags("Search")
            .WithSummary("Command palette lookup: an exact ticket, test case (KEY-TC-n) or session (KEY-R-n) key first, then up to 10 tickets by title.");

        api.MapGet("/me/work", async (GetMyWork.Handler handler, CancellationToken ct) =>
                TypedResults.Ok(await handler.HandleAsync(new GetMyWork.Query(), ct)))
            .WithTags("Search")
            .WithSummary("Open tickets assigned to me grouped by project (at most 500), and my waiting regression items.");
    }

    private static TicketSearchCriteria Criteria(HttpRequest request) =>
        SearchQueryParser.Parse(request.Query.ToDictionary(
            q => q.Key, q => (IReadOnlyList<string?>)q.Value.ToArray(), StringComparer.Ordinal));

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
