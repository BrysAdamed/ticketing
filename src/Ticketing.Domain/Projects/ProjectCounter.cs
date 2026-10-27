namespace Ticketing.Domain.Projects;

/// <summary>
/// Per-project number sequence (D-42). Kept off the project row so allocating a number never bumps the project's row version.
/// Rows are created lazily by the allocator; numbers start at 1 and are never reused.
/// </summary>
public sealed class ProjectCounter
{
    private ProjectCounter()
    {
    }

    public Guid ProjectId { get; private set; }

    public CounterKind Kind { get; private set; }

    public int NextValue { get; private set; }
}

public enum CounterKind
{
    Ticket = 1,
    TestCase = 2,
    Regression = 3,
    Doc = 4,
}
