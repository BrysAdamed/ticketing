using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Auth;
using Ticketing.Application.Boards;
using Ticketing.Application.Comments;
using Ticketing.Application.Docs;
using Ticketing.Application.FeatureFlags;
using Ticketing.Application.Projects;
using Ticketing.Application.Regressions;
using Ticketing.Application.TestCases;
using Ticketing.Application.Tickets;
using Ticketing.Application.Users;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;

namespace Ticketing.Api.DemoData;

/// <summary>A user the seeder acts as: a cookie (web) session, so every handler sees an ordinary signed-in user.</summary>
internal sealed record DemoActor(Guid Id, string Email, string DisplayName, GlobalRole Role) : ICurrentUser
{
    public bool IsAuthenticated => true;

    public WriteChannel Channel => WriteChannel.Web;

    public PatScope? PatScope => null;

    public Guid? PatId => null;

    public DateTimeOffset? PatExpiresAt => null;
}

/// <summary>The time every handler sees while seeding; set before each operation so data is backdated consistently.</summary>
internal sealed class DemoClock : TimeProvider
{
    public DateTimeOffset Now { get; set; }

    public override DateTimeOffset GetUtcNow() => Now;
}

internal sealed class DemoActorHolder
{
    public DemoActor? Current { get; set; }
}

/// <summary>
/// Runs application use cases as a demo user at a chosen time. Each call gets its own DI scope, so the scoped
/// <see cref="IClock"/> captures the time set for that call and the handlers enforce all their usual rules.
/// </summary>
internal sealed class DemoWorkspace(IServiceProvider services, DemoClock clock, DemoActorHolder actors)
{
    public Task<CreateUserResult> CreateUserAsync(DemoActor admin, DateTimeOffset at, string email, string displayName, CancellationToken ct) =>
        RunAsync<CreateUser.Handler, CreateUser.Command, CreateUserResult>(admin, at, new(email, displayName), ct);

    public Task<bool> SetPasswordAsync(DemoActor user, DateTimeOffset at, string token, string password, CancellationToken ct) =>
        RunAsync<SetPassword.Handler, SetPassword.Command, bool>(user, at, new(token, password), ct);

    public Task<SetPasswordLinkDto> IssueSetPasswordLinkAsync(DemoActor admin, DateTimeOffset at, Guid userId, CancellationToken ct) =>
        RunAsync<IssueSetPasswordLink.Handler, IssueSetPasswordLink.Command, SetPasswordLinkDto>(admin, at, new(userId), ct);

    public Task<ProjectDto> CreateProjectAsync(
        DemoActor actor, DateTimeOffset at, string key, string name, string description, ProjectVisibility visibility, CancellationToken ct) =>
        RunAsync<CreateProject.Handler, CreateProject.Command, ProjectDto>(actor, at, new(key, name, description, visibility), ct);

    public Task<ProjectMemberDto> AddMemberAsync(DemoActor owner, DateTimeOffset at, string projectKey, string email, ProjectRole role, CancellationToken ct) =>
        RunAsync<AddProjectMember.Handler, AddProjectMember.Command, ProjectMemberDto>(
            owner, at, new(email, role) { ProjectKeyOrId = projectKey }, ct);

    public Task<TicketSummaryDto> CreateTicketAsync(DemoActor actor, DateTimeOffset at, CreateTicket.Command command, CancellationToken ct) =>
        RunAsync<CreateTicket.Handler, CreateTicket.Command, TicketSummaryDto>(actor, at, command, ct);

    public Task<TicketDto> UpdateTicketAsync(DemoActor actor, DateTimeOffset at, UpdateTicket.Command command, CancellationToken ct) =>
        RunAsync<UpdateTicket.Handler, UpdateTicket.Command, TicketDto>(actor, at, command, ct);

    public Task<IReadOnlyList<TicketSummaryDto>> MoveTicketsAsync(
        DemoActor actor, DateTimeOffset at, IReadOnlyList<string> keys, Guid boardId, TicketStatus? status, CancellationToken ct) =>
        RunAsync<MoveTickets.Handler, MoveTickets.Command, IReadOnlyList<TicketSummaryDto>>(
            actor, at, new(keys, boardId.ToString(), status), ct);

    public Task<CommentDto> AddCommentAsync(DemoActor actor, DateTimeOffset at, string ticketKey, string body, CancellationToken ct) =>
        RunAsync<AddComment.Handler, AddComment.Command, CommentDto>(actor, at, new(body, ticketKey), ct);

    public Task<TicketLinkDto> LinkAsync(DemoActor actor, DateTimeOffset at, string sourceKey, TicketLinkType type, string targetKey, CancellationToken ct) =>
        RunAsync<LinkTickets.Handler, LinkTickets.Command, TicketLinkDto>(actor, at, new(targetKey, type, sourceKey), ct);

    public Task<BoardDto> CreateBoardAsync(
        DemoActor actor, DateTimeOffset at, string name, string description, IReadOnlyList<string> projectKeys, CancellationToken ct) =>
        RunAsync<CreateBoard.Handler, CreateBoard.Command, BoardDto>(actor, at, new(name, description, projectKeys), ct);

    public Task<TestCaseDto> CreateTestCaseAsync(DemoActor actor, DateTimeOffset at, CreateTestCase.Command command, CancellationToken ct) =>
        RunAsync<CreateTestCase.Handler, CreateTestCase.Command, TestCaseDto>(actor, at, command, ct);

    public Task<RegressionSessionDto> StartRegressionAsync(
        DemoActor actor, DateTimeOffset at, string projectKey, string name, string version, CancellationToken ct) =>
        RunAsync<StartRegressionSession.Handler, StartRegressionSession.Command, RegressionSessionDto>(
            actor, at, new(name, version, projectKey), ct);

    public Task<RegressionItemChangeDto> RecordResultAsync(
        DemoActor actor, DateTimeOffset at, string sessionKey, string testCaseKey, RegressionItemStatus status, string? note,
        BugOverrides? bug, CancellationToken ct) =>
        RunAsync<RecordRegressionResult.Handler, RecordRegressionResult.Command, RegressionItemChangeDto>(
            actor, at, new(status, note, bug is not null, bug, sessionKey, testCaseKey), ct);

    public Task<RegressionSessionSummaryDto> CompleteRegressionAsync(DemoActor actor, DateTimeOffset at, string sessionKey, CancellationToken ct) =>
        RunAsync<CompleteRegressionSession.Handler, CompleteRegressionSession.Command, RegressionSessionSummaryDto>(
            actor, at, new(SkipRemaining: true, sessionKey), ct);

    public Task<FlagDto> UpdateFlagAsync(DemoActor admin, DateTimeOffset at, UpdateFlag.Command command, CancellationToken ct) =>
        RunAsync<UpdateFlag.Handler, UpdateFlag.Command, FlagDto>(admin, at, command, ct);

    public Task<DocDto> CreateDocAsync(DemoActor actor, DateTimeOffset at, CreateDoc.Command command, CancellationToken ct) =>
        RunAsync<CreateDoc.Handler, CreateDoc.Command, DocDto>(actor, at, command, ct);

    public Task<DocDto> UpdateDocAsync(DemoActor actor, DateTimeOffset at, UpdateDoc.Command command, CancellationToken ct) =>
        RunAsync<UpdateDoc.Handler, UpdateDoc.Command, DocDto>(actor, at, command, ct);

    public Task<DocCommentDto> AddDocCommentAsync(DemoActor actor, DateTimeOffset at, string docKey, string body, CancellationToken ct) =>
        RunAsync<AddDocComment.Handler, AddDocComment.Command, DocCommentDto>(actor, at, new(body, docKey), ct);

    public async Task<Dictionary<string, DemoActor>> FindUsersAsync(IReadOnlyCollection<string> emails, CancellationToken ct)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ITicketingDbContext>();
        return await db.Users.AsNoTracking()
            .Where(u => emails.Contains(u.Email))
            .ToDictionaryAsync(u => u.Email, u => new DemoActor(u.Id, u.Email, u.DisplayName, u.GlobalRole), StringComparer.Ordinal, ct);
    }

    private async Task<TResult> RunAsync<THandler, TCommand, TResult>(DemoActor actor, DateTimeOffset at, TCommand command, CancellationToken ct)
        where THandler : IHandler<TCommand, TResult>
    {
        clock.Now = at;
        actors.Current = actor;
        try
        {
            await using var scope = services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<THandler>().HandleAsync(command, ct);
        }
        finally
        {
            actors.Current = null;
        }
    }
}
