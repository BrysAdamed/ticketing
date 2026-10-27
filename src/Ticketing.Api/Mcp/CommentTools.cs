using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Comments;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;

namespace Ticketing.Api.Mcp;

[McpServerToolType]
public sealed class CommentTools
{
    [McpServerTool(Name = "list_comments", ReadOnly = true, Idempotent = true, Title = "List comments")]
    [Description("Comments of a ticket, oldest first: id, author, markdown body, createdAt, editedAt, deleted (deleted comments have an empty body) and mentions "
        + "(the mentioned users who are active and can read the project; other mentions read as plain text). Returns { items, nextCursor }.")]
    public static Task<CursorPage<CommentDto>> ListComments(
        ListComments.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListComments.Query(key, new PageRequest(limit, cursor)), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "add_comment", Destructive = false, Title = "Add comment")]
    [Description("Adds a markdown comment (1..20000 characters) to a ticket. Ticket keys such as WEB-42 render as links.")]
    public static Task<CommentDto> AddComment(
        AddComment.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        [Description("Markdown body. " + McpDescriptions.Mentions)] string body,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new AddComment.Command(body, key), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_comment", Destructive = false, Title = "Update comment")]
    [Description("Replaces the body of your own comment. The previous body stays in the ticket history.")]
    public static Task<CommentDto> UpdateComment(
        UpdateComment.Handler handler,
        [Description("Comment id (from list_comments).")] Guid commentId,
        [Description("New markdown body. " + McpDescriptions.Mentions)] string body,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new UpdateComment.Command(body, commentId), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "delete_comment", Destructive = true, Title = "Delete comment")]
    [Description("Deletes your own comment, or any comment if you are a project Owner. A 'Comment deleted' placeholder stays in place.")]
    public static Task<CommentDto> DeleteComment(
        DeleteComment.Handler handler,
        [Description("Comment id (from list_comments).")] Guid commentId,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new DeleteComment.Command(commentId), cancellationToken);
}
