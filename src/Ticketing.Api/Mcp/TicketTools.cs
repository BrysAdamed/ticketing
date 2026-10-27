using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.Mcp;

/// <summary>
/// Ticket tools (spec 9.3). Fields that a null clears (update_ticket) are declared as <see cref="Optional{T}"/> so an
/// omitted argument (leave unchanged) can be told apart from an explicit null (clear).
/// </summary>
[McpServerToolType]
public sealed class TicketTools
{
    private const string Types = "Epic, UserStory, Technical, Spike or Bug";
    private const string Statuses = "ToDo, InProgress, OnHold, Review, ReadyForTesting, Testing, ReadyForDeploy or Done";
    private const string Priorities = "Highest, High, Medium (default), Low or Lowest";
    private const string Severities = "Blocker, Critical, Major, Minor or Trivial";
    private const string Resolutions = "Done, WontDo, Duplicate or CannotReproduce";
    private const string LinkTypes = "Blocks, RelatesTo or Duplicates (RelatesTo is unordered)";

    [McpServerTool(Name = "get_ticket", ReadOnly = true, Idempotent = true, Title = "Get ticket")]
    [Description("Gets a ticket by key (for example WEB-42) or id: all fields incl. description, resolution, reporter, timestamps and rowVersion, "
        + "plus the included collections: children (with progress by status category), links, the latest 50 comments, test cases and "
        + "watchers ({ count, watching, users }). mentions lists the users mentioned in the description who are active and can read the project "
        + "(each comment has its own mentions).")]
    public static Task<TicketDto> GetTicket(
        GetTicket.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        [Description("Collections to include: any of comments, children, links, testCases, watchers. Default: all.")] string[]? include = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetTicket.Query(key, Application.Tickets.GetTicket.Handler.ParseIncludes(include)), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_ticket", Destructive = false, Title = "Create ticket")]
    [Description("Creates a ticket at the bottom of the project backlog (or of a board when boardId is given). Returns the ticket summary with rowVersion.")]
    public static Task<TicketSummaryDto> CreateTicket(
        CreateTicket.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Single-line title, at most 255 characters.")] string title,
        [Description("Ticket type: " + Types + ".")] TicketType type,
        [Description("Markdown description, at most 50000 characters. " + McpDescriptions.Mentions)] string? description = null,
        [Description("Status: " + Statuses + ". Default ToDo.")] TicketStatus? status = null,
        [Description("Priority: " + Priorities + ".")] Priority? priority = null,
        [Description("Severity: " + Severities + ".")] Severity? severity = null,
        [Description("Story points 0..100.")] int? storyPoints = null,
        [Description("Free-text version, at most 50 characters (see get_field_hints).")] string? version = null,
        [Description("Labels: lower case letters, digits, '.', '_' or '-'; at most 20.")] string[]? labels = null,
        [Description("Parent ticket key in the same project. Epics cannot have a parent; at most 3 levels.")] string? parentKey = null,
        [Description("Assignee email, id or 'me'. Must be an active user who can edit the project.")] string? assignee = null,
        [Description("Board id to create the ticket on instead of the backlog.")] Guid? boardId = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new CreateTicket.Command(
                title, type, description, status, priority, severity, storyPoints, version, labels, parentKey, assignee, boardId,
                projectKey, idempotencyKey),
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_tickets", Destructive = false, Title = "Create tickets (batch)")]
    [Description("Creates 1..50 tickets in one project, all or nothing. Each item takes the create_ticket fields except projectKey; "
        + "parentKey may also reference an earlier item of the batch as '#index' (zero-based, for example '#0'). "
        + "Types: " + Types + ". Returns the ticket summaries in input order.")]
    public static Task<IReadOnlyList<TicketSummaryDto>> CreateTickets(
        CreateTickets.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("The tickets: objects with title, type and optional description, status, priority, severity, storyPoints, version, labels, parentKey, assignee, boardId. "
            + "Descriptions take mentions as in create_ticket.")]
        CreateTicket.Command[] tickets,
        [Description("Optional key that makes retries safe.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new CreateTickets.Command(tickets, projectKey, idempotencyKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_ticket", Destructive = false, Title = "Update ticket")]
    [Description("Updates a ticket. Omitted fields stay unchanged; null clears an optional field (description, severity, storyPoints, version, "
        + "parentKey, assignee, resolution). Status side effects: entering Done sets the resolution (default Done), leaving Done clears it. "
        + "Returns the updated ticket.")]
    public static Task<TicketDto> UpdateTicket(
        UpdateTicket.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        [Description("New single-line title.")] string? title = null,
        [Description("Markdown description; null clears. " + McpDescriptions.Mentions)] Optional<string?> description = default,
        [Description("Type: " + Types + ".")] TicketType? type = null,
        [Description("Status: " + Statuses + ".")] TicketStatus? status = null,
        [Description("Resolution: " + Resolutions + ". Only with status Done.")] Optional<Resolution?> resolution = default,
        [Description("Priority: " + Priorities + ".")] Priority? priority = null,
        [Description("Severity: " + Severities + "; null clears.")] Optional<Severity?> severity = default,
        [Description("Story points 0..100; null clears.")] Optional<int?> storyPoints = default,
        [Description("Version text; null clears.")] Optional<string?> version = default,
        [Description("Replaces all labels.")] string[]? labels = null,
        [Description("Labels to add.")] string[]? addLabels = null,
        [Description("Labels to remove.")] string[]? removeLabels = null,
        [Description("Parent ticket key in the same project; null makes the ticket top level.")] Optional<string?> parentKey = default,
        [Description("Assignee email, id or 'me'; null unassigns.")] Optional<string?> assignee = default,
        [Description("Reporter email, id or 'me'.")] string? reporter = null,
        [Description("The rowVersion you read; the update fails with concurrency.conflict if the ticket changed since.")] uint? expectedVersion = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new UpdateTicket.Command
            {
                KeyOrId = key,
                Title = title is null ? default(Optional<string>) : title,
                Description = description,
                Type = type is { } t ? t : default(Optional<TicketType>),
                Status = status is { } s ? s : default(Optional<TicketStatus>),
                Resolution = resolution,
                Priority = priority is { } p ? p : default(Optional<Priority>),
                Severity = severity,
                StoryPoints = storyPoints,
                Version = version,
                Labels = labels is null ? default : new Optional<IReadOnlyList<string>?>(labels),
                AddLabels = addLabels,
                RemoveLabels = removeLabels,
                ParentKey = parentKey,
                Assignee = assignee,
                Reporter = reporter is null ? default(Optional<string>) : reporter,
                ExpectedVersion = expectedVersion,
            },
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "delete_ticket", Destructive = true, Title = "Delete ticket")]
    [Description("Soft-deletes a ticket (project Owners only). Fails with ticket.hasChildren while it has child tickets. The key is never reused.")]
    public static Task<DeleteTicket.Result> DeleteTicket(
        DeleteTicket.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new DeleteTicket.Command(key), cancellationToken);

    [McpServerTool(Name = "get_children_graph", ReadOnly = true, Idempotent = true, Title = "Get children graph")]
    [Description("The children of a ticket (typically an epic) and how they depend on each other. Returns { key, nodes, edges }: "
        + "nodes are the children plus linked tickets outside the parent (external: true), each with blocked = open and blocked by an open ticket; "
        + "edges are { linkId, type, from, to } with type " + LinkTypes + "; for Blocks, from blocks to. "
        + "Use it to find which children can start now (open and not blocked).")]
    public static Task<TicketGraphDto> GetChildrenGraph(
        GetChildrenGraph.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetChildrenGraph.Query(key), cancellationToken);

    [McpServerTool(Name = "get_ticket_history", ReadOnly = true, Idempotent = true, Title = "Get ticket history")]
    [Description("Activity entries of a ticket, newest first: occurredAt, actor, channel (Web, Api, Mcp), action, field, oldValue, newValue. "
        + "Assignee and reporter values are user ids, resolved in 'users'. Returns { items, nextCursor, users }.")]
    public static Task<TicketHistoryPage> GetTicketHistory(
        GetTicketHistory.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetTicketHistory.Query(key, new PageRequest(limit, cursor)), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "link_tickets", Destructive = false, Title = "Link tickets")]
    [Description("Links two tickets, possibly in different projects. Type: " + LinkTypes + ". 'A Blocks B' reads 'B is blocked by A'.")]
    public static Task<TicketLinkDto> LinkTickets(
        LinkTickets.Handler handler,
        [Description("Source ticket key; you need write access to its project.")] string sourceKey,
        [Description("Target ticket key; you need read access to its project.")] string targetKey,
        [Description("Link type: " + LinkTypes + ".")] TicketLinkType type,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new LinkTickets.Command(targetKey, type, sourceKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "unlink_tickets", Destructive = true, Title = "Unlink tickets")]
    [Description("Removes the link sourceKey -[type]-> targetKey. Type: " + LinkTypes + ".")]
    public static Task<UnlinkTickets.Result> UnlinkTickets(
        UnlinkTickets.Handler handler,
        [Description("Source ticket key.")] string sourceKey,
        [Description("Target ticket key.")] string targetKey,
        [Description("Link type: " + LinkTypes + ".")] TicketLinkType type,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new UnlinkTickets.Command(sourceKey, null, targetKey, type), cancellationToken);

    [McpServerTool(Name = "get_field_hints", ReadOnly = true, Idempotent = true, Title = "Get field hints")]
    [Description("Up to 20 previously used values of a field in a project, most recent first. Use them to keep labels and versions consistent.")]
    public static Task<IReadOnlyList<string>> GetFieldHints(
        GetFieldHints.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Field: labels or version.")] HintField field,
        [Description("Case-insensitive prefix filter.")] string? prefix = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetFieldHints.Query(projectKey, field, prefix), cancellationToken);
}
