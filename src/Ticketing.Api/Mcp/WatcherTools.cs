using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Watchers;

namespace Ticketing.Api.Mcp;

/// <summary>Watching tickets (I-32). The watcher list itself comes with <c>get_ticket</c>.</summary>
[McpServerToolType]
public sealed class WatcherTools
{
    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "watch_ticket", Destructive = false, Idempotent = true, Title = "Watch ticket")]
    [Description("Starts watching a ticket you can read (viewers and archived projects included). Watching twice is fine. "
        + "Returns { count, watching, users } with the visible watchers.")]
    public static Task<WatchersDto> WatchTicket(
        WatchTicket.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new WatchTicket.Command(key), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "unwatch_ticket", Destructive = false, Idempotent = true, Title = "Unwatch ticket")]
    [Description("Stops watching a ticket. A later assignment to you or your next comment makes you a watcher again. "
        + "Returns { count, watching, users }.")]
    public static Task<WatchersDto> UnwatchTicket(
        UnwatchTicket.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new UnwatchTicket.Command(key), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "watch_doc", Destructive = false, Idempotent = true, Title = "Watch doc")]
    [Description("Starts watching a page or diagram you can read (viewers and archived projects included); watchers are notified "
        + "about its new comments. Folders cannot be watched (doc.kind.unsupported). Watching twice is fine. "
        + "Returns { count, watching, users } with the visible watchers.")]
    public static Task<WatchersDto> WatchDoc(
        WatchDoc.Handler handler,
        [Description("Doc key (for example WEB-D-12) or id.")] string docKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new WatchDoc.Command(docKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "unwatch_doc", Destructive = false, Idempotent = true, Title = "Unwatch doc")]
    [Description("Stops watching a page or diagram. Your next comment on it or a new mention of you makes you a watcher again. "
        + "Returns { count, watching, users }.")]
    public static Task<WatchersDto> UnwatchDoc(
        UnwatchDoc.Handler handler,
        [Description("Doc key (for example WEB-D-12) or id.")] string docKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new UnwatchDoc.Command(docKey), cancellationToken);
}
