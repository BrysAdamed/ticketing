using System.Globalization;
using System.Text;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Regressions;

/// <summary>The pre-filled bug for a failed regression item (spec 6.11, D-24). Every field can be overridden before the bug is created.</summary>
public sealed record RegressionBugDraft(
    string Title,
    string Description,
    Severity Severity,
    Priority Priority,
    string? Version,
    IReadOnlyList<string> Labels);

/// <summary>Builds <see cref="RegressionBugDraft"/>s from an item's snapshot, so the web dialog, REST and MCP produce identical bugs.</summary>
public static class RegressionBugTemplate
{
    public const string Label = "regression";
    public const string TitlePrefix = "[Regression] ";
    public const Severity DefaultSeverity = Severity.Major;
    public const Priority DefaultPriority = Priority.High;

    private const string StepIndent = "   ";
    private const string Ellipsis = "…";

    /// <param name="foundBy">Display name of whoever recorded the failure.</param>
    /// <param name="foundAt">When the failure was recorded.</param>
    public static RegressionBugDraft Draft(RegressionSession session, string projectKey, RegressionSessionItem item, string foundBy, DateTimeOffset foundAt) =>
        new(
            Truncate(TitlePrefix + item.Title, Ticket.TitleMaxLength),
            Truncate(Description(session, projectKey, item, foundBy, foundAt), Ticket.DescriptionMaxLength),
            DefaultSeverity,
            DefaultPriority,
            session.Version,
            [Label]);

    private static string Description(RegressionSession session, string projectKey, RegressionSessionItem item, string foundBy, DateTimeOffset foundAt)
    {
        var version = session.Version is null ? string.Empty : $" (version {session.Version})";
        var date = foundAt.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var text = new StringBuilder()
            .Append(CultureInfo.InvariantCulture, $"Found in regression session {session.KeyIn(projectKey)} \"{session.Name}\"{version} by {foundBy} on {date}.\n")
            .Append(CultureInfo.InvariantCulture, $"Test case: {item.TestCaseKey} \"{item.Title}\"\n")
            .Append("\n## Preconditions\n")
            .Append(item.Preconditions ?? "None")
            .Append("\n\n## Steps to reproduce\n");

        if (item.Steps.Count == 0)
            text.Append("None");
        for (var i = 0; i < item.Steps.Count; i++)
        {
            if (i > 0)
                text.Append('\n');
            var marker = (i + 1).ToString(CultureInfo.InvariantCulture) + ". ";
            text.Append(marker).Append(IndentContinuation(item.Steps[i]));
        }

        return text
            .Append("\n\n## Expected result\n")
            .Append(item.ExpectedResult ?? "Not specified")
            .Append("\n\n## Actual result\n")
            .Append(item.ResultNote ?? "Not specified")
            .ToString();
    }

    private static string IndentContinuation(string step) =>
        step.ReplaceLineEndings("\n").Replace("\n", "\n" + StepIndent, StringComparison.Ordinal);

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : string.Concat(value.AsSpan(0, maxLength - Ellipsis.Length), Ellipsis);
}
