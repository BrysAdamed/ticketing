namespace Ticketing.Domain.Regressions;

public enum RegressionSessionStatus
{
    InProgress = 1,
    Completed = 2,
    Cancelled = 3,
}

public enum RegressionItemStatus
{
    WaitingForExecution = 1,
    Passed = 2,
    Failed = 3,
    Skipped = 4,
}

public enum ExecutionMode
{
    Manual = 1,
    Automatic = 2,
}
