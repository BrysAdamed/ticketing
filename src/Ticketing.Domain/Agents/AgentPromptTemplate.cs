using System.Globalization;
using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Agents;

/// <summary>
/// One prompt slot (spec 13.3): an instance default per ticket type, the instance guardrails block, or a project override
/// per ticket type. Every change appends an immutable <see cref="AgentPromptTemplateVersion"/>; the row holds the current state.
/// Instance rows that still carry a verbatim built-in (<see cref="FollowsBuiltIn"/>) upgrade when a newer built-in ships;
/// edited rows are left alone.
/// </summary>
public sealed class AgentPromptTemplate
{
    public const int BodyMaxLength = AgentPrompt.LengthLimit;
    public const int ChangeNoteMaxLength = 200;

    private AgentPromptTemplate()
    {
    }

    public Guid Id { get; private set; }

    public AgentPromptScope Scope { get; private set; }

    public Guid? ProjectId { get; private set; }

    /// <summary>Null for the guardrails block.</summary>
    public TicketType? TicketType { get; private set; }

    public AgentPromptMode Mode { get; private set; }

    /// <summary>The template text for Custom rows; null for Inherit and Off rows and for empty guardrails.</summary>
    public string? Body { get; private set; }

    public int CurrentVersion { get; private set; }

    /// <summary>Project Custom rows: the instance default version this override was written against.</summary>
    public int? BasedOnDefaultVersion { get; private set; }

    /// <summary>Instance rows: the built-in release the row last took its text from.</summary>
    public string? BuiltInVersion { get; private set; }

    /// <summary>Instance rows: the current text is a verbatim built-in, so a newer built-in replaces it automatically.</summary>
    public bool FollowsBuiltIn { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Null when the system wrote the current version (built-in).</summary>
    public Guid? UpdatedById { get; private set; }

    public uint RowVersion { get; private set; }

    public AgentPromptSlot Slot => new(TicketType);

    public static (AgentPromptTemplate Template, AgentPromptTemplateVersion Version) CreateInstance(BuiltInPrompt builtIn, DateTimeOffset now)
    {
        var template = new AgentPromptTemplate
        {
            Id = EntityId.New(),
            Scope = AgentPromptScope.Instance,
            TicketType = builtIn.Slot.Type,
            Mode = AgentPromptMode.Custom,
            UpdatedAt = now,
        };
        return (template, template.AdoptBuiltIn(builtIn, actorId: null, now, changeNote: null));
    }

    /// <summary>A project slot that still inherits (version 0); the first <see cref="Save"/> gives it version 1.</summary>
    public static AgentPromptTemplate CreateForProject(Guid projectId, TicketType type, DateTimeOffset now) => new()
    {
        Id = EntityId.New(),
        Scope = AgentPromptScope.Project,
        ProjectId = projectId,
        TicketType = type,
        Mode = AgentPromptMode.Inherit,
        UpdatedAt = now,
    };

    /// <summary>Fails with <c>agent.prompt.versionConflict</c> unless the caller edited the current version.</summary>
    public void EnsureBaseVersion(int baseVersion) => EnsureBaseVersion(CurrentVersion, baseVersion);

    public static void EnsureBaseVersion(int currentVersion, int baseVersion)
    {
        if (currentVersion != baseVersion)
            throw DomainException.Conflict(
                AgentErrors.VersionConflict,
                string.Create(CultureInfo.InvariantCulture, $"The prompt was changed to version {currentVersion} after you opened version {baseVersion}."),
                "Reload the prompt and apply your change again.");
    }

    /// <param name="defaultVersion">The current instance default version for this type; recorded on project Custom rows.</param>
    public AgentPromptTemplateVersion Save(AgentPromptMode mode, string? body, string? changeNote, int? defaultVersion, Guid actorId, DateTimeOffset now)
    {
        var (validMode, validBody) = Validate(mode, body);
        FollowsBuiltIn = false;
        return AddVersion(validMode, validBody, builtInVersion: null, changeNote, actorId, now, restoredFrom: null, defaultVersion);
    }

    /// <summary>Makes an old version current again, as a new version.</summary>
    public AgentPromptTemplateVersion Restore(AgentPromptTemplateVersion version, string? changeNote, int? defaultVersion, Guid actorId, DateTimeOffset now)
    {
        if (version.TemplateId != Id)
            throw new ArgumentException("The version belongs to another template.", nameof(version));
        var (validMode, validBody) = Validate(version.Mode, version.Body);
        FollowsBuiltIn = false;
        return AddVersion(validMode, validBody, builtInVersion: null, changeNote, actorId, now, version.Number, defaultVersion);
    }

    /// <summary>Instance rows: takes the built-in text as a new version (reset to built-in, or the automatic upgrade).</summary>
    public AgentPromptTemplateVersion AdoptBuiltIn(BuiltInPrompt builtIn, Guid? actorId, DateTimeOffset now, string? changeNote)
    {
        if (Scope != AgentPromptScope.Instance || builtIn.Slot != Slot)
            throw new InvalidOperationException($"Built-in {builtIn.Slot} cannot be adopted by the {Scope} {Slot} template.");
        BuiltInVersion = builtIn.Version;
        FollowsBuiltIn = true;
        return AddVersion(AgentPromptMode.Custom, NormalizeBody(builtIn.Body), builtIn.Version, changeNote, actorId, now, restoredFrom: null, defaultVersion: null);
    }

    /// <summary>
    /// Applies a newer built-in to an instance row nobody has edited since it last took a built-in. Returns the new version,
    /// or null when the row is edited, already current, or the new release did not change this slot's text.
    /// </summary>
    public AgentPromptTemplateVersion? UpgradeToBuiltIn(BuiltInPrompt builtIn, DateTimeOffset now)
    {
        if (Scope != AgentPromptScope.Instance || !FollowsBuiltIn || !builtIn.IsNewerThan(BuiltInVersion))
            return null;
        if (NormalizeBody(builtIn.Body) == Body)
        {
            BuiltInVersion = builtIn.Version;
            return null;
        }
        return AdoptBuiltIn(builtIn, actorId: null, now, $"Built-in {builtIn.Version}");
    }

    /// <summary>An Admin edited this instance row and a newer built-in has shipped since it last took one.</summary>
    public bool NewerBuiltInAvailable(BuiltInPrompt builtIn) => IsNewerBuiltInAvailable(Scope, FollowsBuiltIn, BuiltInVersion, builtIn);

    public static bool IsNewerBuiltInAvailable(AgentPromptScope scope, bool followsBuiltIn, string? builtInVersion, BuiltInPrompt builtIn) =>
        scope == AgentPromptScope.Instance && !followsBuiltIn && builtIn.IsNewerThan(builtInVersion);

    private (AgentPromptMode Mode, string? Body) Validate(AgentPromptMode mode, string? body)
    {
        if (!Enum.IsDefined(mode))
            throw DomainException.Invalid("mode", AgentErrors.ModeInvalid, "Mode must be Inherit, Custom or Off.");
        if (Scope == AgentPromptScope.Instance && mode != AgentPromptMode.Custom)
            throw DomainException.Invalid("mode", AgentErrors.ModeInvalid, "Instance defaults and guardrails are always Custom.");
        if (mode != AgentPromptMode.Custom)
            return (mode, null);

        var text = NormalizeBody(body);
        if (text is null)
        {
            if (Slot.IsGuardrails)
                return (mode, null);
            throw DomainException.Invalid("body", AgentErrors.TemplateEmpty, "A custom prompt needs a body.");
        }
        if (text.Length > BodyMaxLength)
            throw DomainException.Invalid(
                "body", AgentErrors.TemplateTooLong, string.Create(CultureInfo.InvariantCulture, $"The template must be at most {BodyMaxLength} characters."));
        PromptTemplate.Parse(text, AgentPromptPlaceholders.Names).EnsureValid("body");
        return (mode, text);
    }

    private AgentPromptTemplateVersion AddVersion(
        AgentPromptMode mode, string? body, string? builtInVersion, string? changeNote, Guid? actorId, DateTimeOffset now, int? restoredFrom, int? defaultVersion)
    {
        Mode = mode;
        Body = body;
        BasedOnDefaultVersion = Scope == AgentPromptScope.Project && mode == AgentPromptMode.Custom ? defaultVersion : null;
        CurrentVersion++;
        UpdatedAt = now;
        UpdatedById = actorId;
        return AgentPromptTemplateVersion.Create(
            Id, CurrentVersion, mode, body, builtInVersion, Text.Optional(changeNote, "changeNote", ChangeNoteMaxLength), actorId, now, restoredFrom);
    }

    private static string? NormalizeBody(string? body)
    {
        var text = body?.Replace("\r\n", "\n", StringComparison.Ordinal).Trim();
        return string.IsNullOrEmpty(text) ? null : text;
    }
}

/// <summary>An immutable snapshot of a template; never updated or deleted.</summary>
public sealed class AgentPromptTemplateVersion
{
    private AgentPromptTemplateVersion()
    {
    }

    public Guid TemplateId { get; private set; }

    public int Number { get; private set; }

    public AgentPromptMode Mode { get; private set; }

    public string? Body { get; private set; }

    /// <summary>Set when the version is a verbatim built-in, for example <c>2026.10.1</c>.</summary>
    public string? BuiltInVersion { get; private set; }

    public string? ChangeNote { get; private set; }

    /// <summary>Null for system versions (built-ins).</summary>
    public Guid? AuthorId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public int? RestoredFrom { get; private set; }

    internal static AgentPromptTemplateVersion Create(
        Guid templateId, int number, AgentPromptMode mode, string? body, string? builtInVersion, string? changeNote, Guid? authorId,
        DateTimeOffset now, int? restoredFrom) => new()
    {
        TemplateId = templateId,
        Number = number,
        Mode = mode,
        Body = body,
        BuiltInVersion = builtInVersion,
        ChangeNote = changeNote,
        AuthorId = authorId,
        CreatedAt = now,
        RestoredFrom = restoredFrom,
    };
}
