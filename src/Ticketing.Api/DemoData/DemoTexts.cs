using System.Globalization;
using Ticketing.Domain.Tickets;

namespace Ticketing.Api.DemoData;

/// <summary>Markdown descriptions for tickets without a hand-written one, and comment bodies.</summary>
internal static class DemoTexts
{
    private static readonly string[] Criteria =
    [
        "Works in the latest two versions of Chrome, Firefox, Safari and Edge",
        "Covered by unit tests and at least one end-to-end test",
        "Copy approved by the product team",
        "Behind a feature flag until the rollout is agreed",
        "Analytics event added and documented in the tracking plan",
        "Empty, loading and error states are designed and implemented",
        "Usable with the keyboard and announced correctly by screen readers",
        "No new errors in Sentry after the release",
        "Translated into Polish and German",
        "Mentioned in the release notes",
    ];

    private static readonly string[] TechTasks =
    [
        "Implement behind a configuration switch",
        "Add metrics and an alert for the failure case",
        "Load test on staging with production-like data",
        "Update the runbook",
        "Remove the old code path one release later",
        "Walk on-call through the change",
        "Document the decision in the architecture log",
    ];

    private static readonly string[] Reporters = ["Support (Zendesk #{0})", "QA during exploratory testing", "Sentry alert", "A customer on Trustpilot", "Monitoring"];

    private static readonly string[] Frequencies = ["Always", "About 1 in 5 attempts", "Intermittent", "Only under load"];

    private static readonly string[] General =
    [
        "Discussed in refinement: we keep the scope as described and move anything else into a follow-up.",
        "I can pick this up after the stand-up tomorrow.",
        "Is there a design for the empty state? I couldn't find it in Figma.",
        "Moved up after the sales call on Monday: two enterprise prospects asked about this.",
        "Draft PR is up: https://git.example.com/shop/pull/{0}. Early feedback welcome.",
        "The estimate assumes we can reuse the existing component. If we can't, add 3 points.",
        "Checked with legal, no change to the privacy notice is needed.",
        "Blocked until the API contract is final. @Daniel, can you confirm the field names?",
        "Added acceptance criteria after the call with support.",
        "Let's time-box this to two days and revisit in the next refinement.",
        "Code review done, two small comments on naming. Approved otherwise.",
        "Demoed in the sprint review, stakeholders are happy with it.",
        "Splitting the migration into a separate ticket so this one can ship first.",
    ];

    private static readonly string[] BugComments =
    [
        "Reproduced on staging with the steps above. Happens in about 1 of 5 attempts.",
        "Could not reproduce in Firefox. Chrome and Safari are affected.",
        """
        Root cause: we read the total before the async call completes.

        ```ts
        const total = await this.cart.total(); // the await was missing
        ```
        """,
        "Sentry shows {0} events in the last 24 hours, all from the latest release.",
        "Hotfix deployed to production at 14:20, monitoring it for an hour.",
        "Added a regression test so this cannot come back silently.",
        "Support confirmed with the customer that it works now.",
        "Workaround for support until the fix ships: ask the customer to refresh the page and retry.",
    ];

    private static readonly string[] TechComments =
    [
        """
        Before and after on staging:

        | Metric | Before | After |
        | --- | --- | --- |
        | p95 latency | 420 ms | 180 ms |
        | CPU | 64 % | 41 % |
        """,
        "Runbook updated: https://wiki.example.com/runbooks/{0}",
        "Rolled out to staging. Production on Tuesday, after the change advisory board.",
        "This touches the shared config, so I'll pair with on-call for the rollout.",
    ];

    public static string Describe(PlannedTicketView ticket, Random random) => ticket.Type switch
    {
        TicketType.UserStory => Story(ticket, random),
        TicketType.Bug => Bug(ticket, random),
        TicketType.Spike => Spike(random),
        _ => Technical(ticket, random),
    };

    public static string Comment(TicketType type, Random random)
    {
        var pool = type switch
        {
            TicketType.Bug => random.NextDouble() < 0.7 ? BugComments : General,
            TicketType.Technical => random.NextDouble() < 0.5 ? TechComments : General,
            _ => General,
        };
        var text = pool[random.Next(pool.Length)];
        return string.Format(CultureInfo.InvariantCulture, text, random.Next(120, 2400));
    }

    private static string Story(PlannedTicketView ticket, Random random)
    {
        var context = ticket.Epic is { } epic
            ? $"Part of **{epic}**."
            : "Raised in the last product review.";
        return $"""
            {context}

            ## Acceptance criteria

            {Checklist(Criteria, 3 + random.Next(2), random)}
            """;
    }

    private static string Bug(PlannedTicketView ticket, Random random)
    {
        var reporter = string.Format(CultureInfo.InvariantCulture, Reporters[random.Next(Reporters.Length)], random.Next(41000, 48999));
        return $"""
            Reported by: {reporter}.

            | Field | Value |
            | --- | --- |
            | Environment | {(random.NextDouble() < 0.7 ? "Production" : "Staging")} |
            | Version | {ticket.Version ?? "1.4.0"} |
            | Frequency | {Frequencies[random.Next(Frequencies.Length)]} |
            | Customers affected | {random.Next(1, 60)} in the last 7 days |

            ## Expected

            The flow completes without errors and the customer sees the right data.

            ## Definition of done

            - [ ] Root cause written down in this ticket
            - [ ] Regression test added
            - [ ] Fix verified on staging
            """;
    }

    private static string Technical(PlannedTicketView ticket, Random random)
    {
        var why = ticket.Epic is { } epic
            ? $"Needed for **{epic}**."
            : random.NextDouble() < 0.5 ? "Technical debt picked up in the last retrospective." : "Requested by on-call after the last incident review.";
        return $"""
            ## Why

            {why}

            ## Tasks

            {Checklist(TechTasks, 3, random)}
            """;
    }

    private static string Spike(Random random) => $"""
        Time-box: **{2 + random.Next(2)} days**.

        ## Questions

        - What does it cost at our volume?
        - What are the integration and migration risks?
        - How easily can we roll back?

        ## Output

        A one-page write-up with a recommendation, presented in the architecture sync.
        """;

    private static string Checklist(string[] pool, int count, Random random) =>
        string.Join('\n', pool.OrderBy(_ => random.Next()).Take(count).Select(item => $"- [ ] {item}"));
}

internal sealed record PlannedTicketView(TicketType Type, string? Epic, string? Version);
