using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;

namespace Ticketing.Application.Regressions;

/// <summary>
/// Starts a regression session (spec 6.11, D-20, D-21): in one transaction allocates <c>KEY-R-n</c> and snapshots every
/// non-archived Manual or Automatic test case. Manual items wait for execution, Automatic items are auto-passed.
/// </summary>
public static class StartRegressionSession
{
    public sealed record Command(
        string? Name = null,
        string? Version = null,
        [property: JsonIgnore] string ProjectKeyOrId = "",
        [property: JsonIgnore] string? IdempotencyKey = null) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .MaxLength("name", Name, RegressionSession.NameMaxLength)
            .MaxLength("version", Version, RegressionSession.VersionMaxLength);
    }

    public sealed class Handler(
        ITicketingDbContext db,
        IProjectAccess access,
        ICurrentUser currentUser,
        IClock clock,
        IActivityLog activity,
        IProjectCounters counters,
        IIdempotency idempotency) : IHandler<Command, RegressionSessionDto>
    {
        public async Task<RegressionSessionDto> HandleAsync(Command command, CancellationToken cancellationToken)
        {
            command.EnsureValid();
            var grant = await access.EnsureCanWriteAsync(command.ProjectKeyOrId, cancellationToken);
            return await idempotency.ExecuteAsync(
                command.IdempotencyKey, "regressions.start", command with { IdempotencyKey = null, ProjectKeyOrId = grant.ProjectId.ToString() },
                ct => StartAsync(grant, command, ct), cancellationToken);
        }

        private async Task<RegressionSessionDto> StartAsync(ProjectAccessGrant grant, Command command, CancellationToken cancellationToken)
        {
            var session = await db.InTransactionAsync(
                async ct =>
                {
                    var projectId = grant.ProjectId;
                    var cases = await db.TestCases.AsNoTracking()
                        .Where(c => c.ProjectId == projectId && c.ArchivedAt == null
                            && (c.Status == TestCaseStatus.Manual || c.Status == TestCaseStatus.Automatic))
                        .ToListAsync(ct);
                    var number = await counters.NextAsync(projectId, CounterKind.Regression, ct);
                    var started = RegressionSession.Start(projectId, grant.ProjectKey, number, command.Name, command.Version, cases, currentUser.Id, clock.Now);
                    db.RegressionSessions.Add(started);
                    activity.Record(ActivityEntityType.RegressionSession, started.Id, projectId, "regression.started", new
                    {
                        key = HumanKeys.Regression(grant.ProjectKey, number),
                        started.Name,
                        started.Version,
                        items = started.Items.Count,
                        autoPassed = started.Items.Count(i => i.IsAutoPassed),
                    });
                    await db.SaveChangesAsync(ct);
                    return started;
                },
                cancellationToken);

            var target = new RegressionTarget(session.Id, session.ProjectId, session.Number, session.StartedById, grant);
            return await RegressionQueries.LoadAsync(db, currentUser, target, RegressionQueries.ItemFilter.All, cancellationToken);
        }
    }
}
