using System.Globalization;
using Ticketing.Domain.Common;
using Ticketing.Domain.TestCases;

namespace Ticketing.Domain.Regressions;

public sealed class RegressionSession
{
    public const int NameMaxLength = 100;
    public const int VersionMaxLength = 50;
    public const string SkippedAtCompletionNote = "Skipped at completion";

    private readonly List<RegressionSessionItem> _items = [];

    private RegressionSession()
    {
        Name = null!;
    }

    public Guid Id { get; private set; }

    public Guid ProjectId { get; private set; }

    public int Number { get; private set; }

    public string Name { get; private set; }

    public string? Version { get; private set; }

    public RegressionSessionStatus Status { get; private set; }

    public DateTimeOffset StartedAt { get; private set; }

    public Guid StartedById { get; private set; }

    public DateTimeOffset? CompletedAt { get; private set; }

    public Guid? CompletedById { get; private set; }

    public DateTimeOffset? CancelledAt { get; private set; }

    public Guid? CancelledById { get; private set; }

    public uint RowVersion { get; private set; }

    public IReadOnlyList<RegressionSessionItem> Items => _items;

    /// <summary>
    /// Starts a session (spec 6.11): snapshots every non-archived Manual or Automatic test case, ordered by number.
    /// Manual cases wait for execution; Automatic cases are auto-passed with no executor.
    /// </summary>
    public static RegressionSession Start(
        Guid projectId, string projectKey, int number, string? name, string? version,
        IEnumerable<TestCase> testCases, Guid startedById, DateTimeOffset now)
    {
        var eligible = testCases.Where(c => c.ProjectId == projectId && c.IsEligibleForRegression).OrderBy(c => c.Number).ToList();
        if (eligible.Count == 0)
            throw DomainException.Conflict(
                RegressionErrors.NoEligibleCases, "The project has no Manual or Automatic test cases to run.",
                "Mark at least one test case Manual (with steps) or Automatic.");

        var session = new RegressionSession
        {
            Id = EntityId.New(),
            ProjectId = projectId,
            Number = number,
            Name = Text.Optional(name, "name", NameMaxLength) ?? DefaultName(now),
            Version = Text.Optional(version, "version", VersionMaxLength),
            Status = RegressionSessionStatus.InProgress,
            StartedAt = now,
            StartedById = startedById,
        };

        for (var i = 0; i < eligible.Count; i++)
            session._items.Add(RegressionSessionItem.Snapshot(session.Id, eligible[i], projectKey, i + 1, now));
        return session;
    }

    public static string DefaultName(DateTimeOffset now) =>
        "Regression " + now.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public string KeyIn(string projectKey) => HumanKeys.Regression(projectKey, Number);

    public void EnsureInProgress()
    {
        if (Status != RegressionSessionStatus.InProgress)
            throw DomainException.Conflict(RegressionErrors.NotInProgress, "The regression session is no longer in progress.");
    }

    public void Complete(bool skipRemaining, Guid actorId, DateTimeOffset now)
    {
        EnsureInProgress();
        var waiting = _items.Where(i => i.Status == RegressionItemStatus.WaitingForExecution).ToList();
        if (waiting.Count > 0 && !skipRemaining)
            throw DomainException.Conflict(
                RegressionErrors.HasWaitingItems, $"{waiting.Count} item(s) are still waiting for execution.", "Record their results or skip the remaining items.");

        foreach (var item in waiting)
            item.SkipAtCompletion(actorId, now);
        Status = RegressionSessionStatus.Completed;
        CompletedAt = now;
        CompletedById = actorId;
    }

    public void Cancel(Guid actorId, DateTimeOffset now)
    {
        EnsureInProgress();
        Status = RegressionSessionStatus.Cancelled;
        CancelledAt = now;
        CancelledById = actorId;
    }

    public RegressionSummary Summarize() => RegressionSummary.From(_items);
}

public sealed record RegressionSummary(int Total, int PassedManual, int PassedAutomatic, int Failed, int Skipped, int Waiting, int BugsCreated)
{
    public int Passed => PassedManual + PassedAutomatic;

    /// <summary>passed / (passed + failed); null when nothing has passed or failed yet.</summary>
    public double? PassRate => Passed + Failed == 0 ? null : (double)Passed / (Passed + Failed);

    public static RegressionSummary From(IEnumerable<RegressionSessionItem> items)
    {
        var list = items.ToList();
        return new RegressionSummary(
            list.Count,
            list.Count(i => i.Status == RegressionItemStatus.Passed && i.ExecutionMode == ExecutionMode.Manual),
            list.Count(i => i.Status == RegressionItemStatus.Passed && i.ExecutionMode == ExecutionMode.Automatic),
            list.Count(i => i.Status == RegressionItemStatus.Failed),
            list.Count(i => i.Status == RegressionItemStatus.Skipped),
            list.Count(i => i.Status == RegressionItemStatus.WaitingForExecution),
            list.Count(i => i.BugTicketId is not null));
    }
}
