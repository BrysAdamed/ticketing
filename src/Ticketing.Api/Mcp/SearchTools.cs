using System.ComponentModel;
using ModelContextProtocol.Server;
using Ticketing.Application.Attachments;
using Ticketing.Application.Common;
using Ticketing.Application.Search;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.Mcp;

/// <summary>
/// Search and attachment tools (spec 9.3). <c>search_tickets</c> feeds its arguments through the same parser as the REST
/// query string, so both transports apply identical rules and validation.
/// </summary>
[McpServerToolType]
public sealed class SearchTools
{
    [McpServerTool(Name = "search_tickets", ReadOnly = true, Idempotent = true, Title = "Search tickets")]
    [Description("Searches tickets in every project you can read. All filters are optional and combined with AND; list values are OR-ed "
        + "(labels: all of). Returns ticket summaries { items, nextCursor, total } (total only on the first page, capped at 10000).")]
    public static Task<TicketSearchPage> SearchTickets(
        SearchTickets.Handler handler,
        [Description("Project keys, for example [\"WEB\"]. Default: all readable projects.")] string[]? projectKeys = null,
        [Description("Full text over title and description (web search syntax: \"phrase\", -exclude, or) plus partial title match; a ticket key also matches.")] string? text = null,
        [Description("Any of: Epic, UserStory, Technical, Spike, Bug.")] TicketType[]? types = null,
        [Description("Any of: ToDo, InProgress, OnHold, Review, ReadyForTesting, Testing, ReadyForDeploy, Done.")] TicketStatus[]? statuses = null,
        [Description("Status categories, any of: ToDo, InProgress, Done. Open tickets = [ToDo, InProgress].")] StatusCategory[]? statusCategory = null,
        [Description("Any of: Highest, High, Medium, Low, Lowest.")] Priority[]? priorities = null,
        [Description("Any of: Blocker, Critical, Major, Minor, Trivial, none (no severity).")] string[]? severities = null,
        [Description("Assignees, any of: an email, a user id, 'me' or 'unassigned'.")] string[]? assignee = null,
        [Description("Exclude these assignees: emails, user ids, 'me', or 'unassigned' (drops tickets without assignee).")] string[]? assigneeNot = null,
        [Description("Reporters: emails, user ids or 'me'.")] string[]? reporter = null,
        [Description("Labels; tickets must have all of them.")] string[]? labels = null,
        [Description("Exact version, or 'none' for tickets without a version.")] string? version = null,
        [Description("Parent ticket key (for example WEB-12): its direct children.")] string? parentKey = null,
        [Description("'backlog', 'board' (any board) or a board id.")] string? location = null,
        [Description("Created on/after: date (2026-10-01, whole UTC day) or UTC timestamp.")] string? createdFrom = null,
        [Description("Created on/before: date (inclusive) or UTC timestamp (exclusive).")] string? createdTo = null,
        [Description("Updated on/after: date or UTC timestamp.")] string? updatedFrom = null,
        [Description("Updated on/before: date (inclusive) or UTC timestamp (exclusive).")] string? updatedTo = null,
        [Description("Resolved (entered Done) on/after: date or UTC timestamp.")] string? resolvedFrom = null,
        [Description("Resolved on/before: date (inclusive) or UTC timestamp (exclusive).")] string? resolvedTo = null,
        [Description("Only bugs created from regression session items.")] bool? fromRegression = null,
        [Description("Sort: updated (default), created, priority, key or rank (rank is meaningful inside one backlog or board).")] TicketSort? sort = null,
        [Description("Asc or Desc. Default: Desc for updated/created, Asc otherwise (priority Asc = Highest first).")] SortOrder? order = null,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page (same filters and sort).")] string? cursor = null,
        CancellationToken cancellationToken = default)
    {
        var query = new Dictionary<string, IReadOnlyList<string?>>(StringComparer.Ordinal);
        void Add(string name, IEnumerable<string?>? values)
        {
            if (values is not null)
                query[name] = [.. values];
        }

        Add("project", projectKeys);
        Add("q", text is null ? null : [text]);
        Add("type", types?.Select(t => t.ToString()));
        Add("status", statuses?.Select(s => s.ToString()));
        Add("category", statusCategory?.Select(c => c.ToString()));
        Add("priority", priorities?.Select(p => p.ToString()));
        Add("severity", severities);
        Add("assignee", assignee);
        Add("assigneeNot", assigneeNot);
        Add("reporter", reporter);
        Add("label", labels);
        Add("version", version is null ? null : [version]);
        Add("parent", parentKey is null ? null : [parentKey]);
        Add("location", location is null ? null : [location]);
        Add("createdFrom", createdFrom is null ? null : [createdFrom]);
        Add("createdTo", createdTo is null ? null : [createdTo]);
        Add("updatedFrom", updatedFrom is null ? null : [updatedFrom]);
        Add("updatedTo", updatedTo is null ? null : [updatedTo]);
        Add("resolvedFrom", resolvedFrom is null ? null : [resolvedFrom]);
        Add("resolvedTo", resolvedTo is null ? null : [resolvedTo]);
        Add("fromRegression", fromRegression is null ? null : [fromRegression.Value ? "true" : "false"]);
        Add("sort", sort is null ? null : [sort.Value.ToString()]);
        Add("order", order is null ? null : [order.Value.ToString()]);

        return handler.HandleAsync(new SearchTickets.Query(SearchQueryParser.Parse(query), new PageRequest(limit, cursor)), cancellationToken);
    }

    [McpServerTool(Name = "list_attachments", ReadOnly = true, Idempotent = true, Title = "List attachments")]
    [Description("Lists a ticket's attachments, oldest first: id, fileName, contentType, sizeBytes, uploadedBy, uploadedAt and the download url "
        + "(relative to the server, needs the same bearer token). Read text, CSV and JSON files with get_attachment_text.")]
    public static Task<IReadOnlyList<AttachmentDto>> ListAttachments(
        ListAttachments.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListAttachments.Query(key), cancellationToken);

    [McpServerTool(Name = "get_attachment_text", ReadOnly = true, Idempotent = true, Title = "Get attachment text")]
    [Description("Returns the content of a text/plain, text/csv or application/json attachment, up to 200 KB (truncated = true when longer). "
        + "Images, PDF and ZIP files cannot be read this way.")]
    public static Task<AttachmentTextDto> GetAttachmentText(
        GetAttachmentText.Handler handler,
        [Description("Attachment id from list_attachments.")] Guid attachmentId,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetAttachmentText.Query(attachmentId), cancellationToken);
}
