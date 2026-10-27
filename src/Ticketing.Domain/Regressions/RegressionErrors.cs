namespace Ticketing.Domain.Regressions;

public static class RegressionErrors
{
    public const string NotFound = "regression.notFound";
    public const string ItemNotFound = "regression.item.notFound";
    public const string NoEligibleCases = "regression.noEligibleCases";
    public const string NotInProgress = "regression.notInProgress";
    public const string HasWaitingItems = "regression.hasWaitingItems";
    public const string CancelForbidden = "regression.cancel.forbidden";
    public const string NotAssignee = "regression.item.notAssignee";
    public const string AssigneeInvalid = "regression.item.assigneeInvalid";
    public const string NoteRequired = "regression.item.noteRequired";
    public const string BugExists = "regression.item.bugExists";
    public const string BugRequiresFailure = "regression.item.notFailed";
}
