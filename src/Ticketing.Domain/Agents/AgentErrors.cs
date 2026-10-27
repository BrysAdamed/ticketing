namespace Ticketing.Domain.Agents;

public static class AgentErrors
{
    public const string Disabled = "agent.disabled";
    public const string Unavailable = "agent.unavailable";
    public const string ProjectDisabled = "agent.project.disabled";
    public const string RepositoryRequired = "agent.project.repositoryRequired";
    public const string TypeOff = "agent.type.off";
    public const string TicketDone = "agent.ticket.done";
    public const string PromptNotFound = "agent.prompt.notFound";
    public const string VersionNotFound = "agent.prompt.versionNotFound";
    public const string VersionConflict = "agent.prompt.versionConflict";
    public const string PromptTooLong = "agent.prompt.tooLong";
    public const string ModeInvalid = "agent.prompt.modeInvalid";
    public const string TemplateEmpty = "agent.template.empty";
    public const string TemplateTooLong = "agent.template.tooLong";
    public const string UnknownPlaceholder = "agent.template.unknownPlaceholder";
    public const string UnclosedPlaceholder = "agent.template.unclosedPlaceholder";
    public const string UnbalancedIf = "agent.template.unbalancedIf";
    public const string NestedIf = "agent.template.nestedIf";
    public const string TemplateInvalid = "agent.template.invalid";
}
