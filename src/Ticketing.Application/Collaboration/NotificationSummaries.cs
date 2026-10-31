using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Collaboration;

/// <summary>A regression session as named in summaries.</summary>
public sealed record SessionLabel(string Key, string Name);

/// <summary>Names the summaries refer to, loaded once per save.</summary>
public sealed record SummaryNames(IReadOnlyDictionary<Guid, string> Boards, IReadOnlyDictionary<Guid, SessionLabel> Sessions);

/// <summary>
/// The one-line English summaries shown after the actor's name (D-94). They name statuses, priorities, boards and sessions
/// but never repeat user-written text such as comments or descriptions; the ticket key and title are joined in when listing.
/// </summary>
public static class NotificationSummaries
{
    /// <summary>The summary of a mention in a page's content; its notification links to the page, not to the comments.</summary>
    public const string MentionedOnPage = "mentioned you on the page";

    public static string For(NotificationKind kind, CollaborationEvent e, SummaryNames names) => (kind, e) switch
    {
        (NotificationKind.Assigned, _) => "assigned the ticket to you",
        (NotificationKind.Mentioned, _) when MentionRules.OnPage(e) => MentionedOnPage,
        (NotificationKind.Mentioned, _) when MentionRules.InComment(e) => "mentioned you in a comment",
        (NotificationKind.Mentioned, TicketCreated or DescriptionChanged) => "mentioned you in the description",
        (NotificationKind.Mentioned, _) => "mentioned you",
        (NotificationKind.Commented, _) => "commented",
        (NotificationKind.StatusChanged, StatusChanged { From: { } from, To: { } to }) => $"changed the status from {Label(from)} to {Label(to)}",
        (NotificationKind.StatusChanged, StatusChanged { To: { } to }) => $"changed the status to {Label(to)}",
        (NotificationKind.StatusChanged, _) => "changed the status",
        (NotificationKind.PriorityRaised, PriorityChanged { To: { } to }) => $"raised the priority to {to}",
        (NotificationKind.PriorityRaised, _) => "raised the priority",
        (NotificationKind.Moved, TicketMoved { ToBoardId: null }) => "moved the ticket to the backlog",
        (NotificationKind.Moved, TicketMoved { ToBoardId: { } board }) when names.Boards.TryGetValue(board, out var name) => $"moved the ticket to board {name}",
        (NotificationKind.Moved, _) => "moved the ticket to a board",
        (NotificationKind.Deleted, _) => "deleted the ticket",
        (NotificationKind.RegressionItemAssigned, RegressionItemAssigned item) when names.Sessions.TryGetValue(item.SessionId, out var session) =>
            $"assigned you {item.TestCaseKey} in {session.Key} ({session.Name})",
        (NotificationKind.RegressionItemAssigned, RegressionItemAssigned item) => $"assigned you {item.TestCaseKey}",
        _ => "updated the ticket",
    };

    public static string Label(TicketStatus status) => status switch
    {
        TicketStatus.ToDo => "To Do",
        TicketStatus.InProgress => "In Progress",
        TicketStatus.OnHold => "On Hold",
        TicketStatus.ReadyForTesting => "Ready for Testing",
        TicketStatus.ReadyForDeploy => "Ready for Deploy",
        _ => status.ToString(),
    };
}
