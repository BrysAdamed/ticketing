using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Comments;
using Ticketing.Application.Common;

namespace Ticketing.Api.Mcp;

/// <summary>The comment thread below pages and diagrams (docs refinement D12), with the rules of ticket comments.</summary>
[McpServerToolType]
public sealed class DocCommentTools
{
    private const string DocKey = "Doc key of a page or diagram (for example WEB-D-12) or id.";
    private const string CommentId = "Doc comment id (from list_doc_comments).";

    [McpServerTool(Name = "list_doc_comments", ReadOnly = true, Idempotent = true, Title = "List doc comments")]
    [Description("Comments of a page or diagram, oldest first: id, docKey, author, markdown body, createdAt, editedAt, deleted (deleted comments "
        + "have an empty body), canEdit, canDelete. Folders have none. Returns { items, nextCursor }.")]
    public static Task<CursorPage<DocCommentDto>> ListDocComments(
        ListDocComments.Handler handler,
        [Description(DocKey)] string docKey,
        [Description("Page size 1..100, default 25.")] int? limit = null,
        [Description("nextCursor from the previous page.")] string? cursor = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListDocComments.Query(docKey, new PageRequest(limit, cursor)), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "add_doc_comment", Destructive = false, Title = "Add doc comment")]
    [Description("Adds a markdown comment (1..20000 characters) below a page or diagram. Ticket keys such as WEB-42 render as links. "
        + "The doc's author and earlier commenters are notified.")]
    public static Task<DocCommentDto> AddDocComment(
        AddDocComment.Handler handler,
        [Description(DocKey)] string docKey,
        [Description("Markdown body.")] string body,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new AddDocComment.Command(body, docKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_doc_comment", Destructive = false, Title = "Update doc comment")]
    [Description("Replaces the body of your own doc comment. The previous body stays in the doc's history.")]
    public static Task<DocCommentDto> UpdateDocComment(
        UpdateDocComment.Handler handler,
        [Description(CommentId)] Guid commentId,
        [Description("New markdown body.")] string body,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new UpdateDocComment.Command(body, commentId), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "delete_doc_comment", Destructive = true, Title = "Delete doc comment")]
    [Description("Deletes your own doc comment, or any doc comment if you are a project Owner. A 'Comment deleted' placeholder stays in place.")]
    public static Task<DocCommentDto> DeleteDocComment(
        DeleteDocComment.Handler handler,
        [Description(CommentId)] Guid commentId,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new DeleteDocComment.Command(commentId), cancellationToken);
}
