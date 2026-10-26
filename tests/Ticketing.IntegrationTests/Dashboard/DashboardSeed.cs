using Microsoft.EntityFrameworkCore;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Dashboard;

[CollectionDefinition(nameof(DashboardCollection))]
public sealed class DashboardCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>One ticket to seed. Times default to "now"; <see cref="ResolvedAt"/> is used when the status is Done.</summary>
public sealed record TicketSeed(int Number, TicketType Type = TicketType.UserStory, TicketStatus Status = TicketStatus.ToDo)
{
    public Priority Priority { get; init; } = Priority.Medium;

    public Severity? Severity { get; init; }

    public int? Points { get; init; }

    public string? Version { get; init; }

    public Guid? AssigneeId { get; init; }

    public int? ParentNumber { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    public DateTimeOffset? ResolvedAt { get; init; }

    public bool Deleted { get; init; }
}

/// <summary>Regression session to seed: manual cases get <see cref="Results"/> in order; bugs attach to failed items in order.</summary>
public sealed record SessionSeed(int Number, params RegressionItemStatus[] Results)
{
    public string? Version { get; init; }

    public int AutomaticCases { get; init; }

    public DateTimeOffset StartedAt { get; init; } = DateTimeOffset.UtcNow;

    public RegressionSessionStatus EndStatus { get; init; } = RegressionSessionStatus.InProgress;

    public int[] BugTicketNumbers { get; init; } = [];
}

/// <summary>Arrange helpers for dashboard tests. Data goes straight into the database through the domain model, so times can be set freely.</summary>
public static class DashboardSeeding
{
    public static Task<Guid> CreateProjectAsync(
        this TicketingApiFactory api, string key, TestUser owner, ProjectVisibility visibility = ProjectVisibility.Private,
        params (TestUser User, ProjectRole Role)[] members) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = Project.Create(key, $"{key} project", null, visibility, owner.Id, now);
            foreach (var (user, role) in members)
                project.AddMember(user.Id, role, owner.Id, now);
            db.Projects.Add(project);
            await db.SaveChangesAsync();
            return project.Id;
        });

    public static Task DeleteProjectAsync(this TicketingApiFactory api, Guid projectId, Guid actorId) =>
        api.WithDbAsync(async db =>
        {
            var project = await db.Projects.SingleAsync(p => p.Id == projectId);
            project.Archive(actorId, DateTimeOffset.UtcNow);
            project.Delete(actorId, DateTimeOffset.UtcNow, project.Key);
            return await db.SaveChangesAsync();
        });

    public static Task<Dictionary<int, Guid>> AddTicketsAsync(this TicketingApiFactory api, Guid projectId, Guid actorId, params TicketSeed[] seeds) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var byNumber = await db.Tickets.Where(t => t.ProjectId == projectId).ToDictionaryAsync(t => t.Number);
            foreach (var seed in seeds.OrderBy(s => s.ParentNumber is null ? 0 : 1))
            {
                var created = seed.CreatedAt ?? now;
                var ticket = Ticket.Create(projectId, seed.Number, $"Ticket {seed.Number}", seed.Type, actorId, "a0", created);
                ticket.ChangePriority(seed.Priority);
                ticket.ChangeSeverity(seed.Severity);
                ticket.ChangeStoryPoints(seed.Points);
                ticket.ChangeVersion(seed.Version);
                ticket.AssignTo(seed.AssigneeId);
                ticket.ChangeStatus(seed.Status, null, seed.ResolvedAt ?? created);
                if (seed.ParentNumber is { } parent)
                    ticket.SetParent(byNumber[parent], [], 1);
                ticket.Touch(seed.UpdatedAt ?? created);
                if (seed.Deleted)
                    ticket.Delete(actorId, now);
                db.Tickets.Add(ticket);
                byNumber[seed.Number] = ticket;
            }
            await db.SaveChangesAsync();
            return byNumber.ToDictionary(p => p.Key, p => p.Value.Id);
        });

    public static Task AddTestCasesAsync(
        this TicketingApiFactory api, Guid projectId, Guid actorId, int @new, int manual, int automatic, int archivedManual = 0) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var number = await db.TestCases.CountAsync(c => c.ProjectId == projectId);
            void Add(TestCaseStatus status, bool archived)
            {
                var testCase = TestCase.Create(projectId, ++number, $"Case {number}", actorId, now);
                if (status != TestCaseStatus.New)
                    testCase.ChangeStepsAndStatus(["Do the thing"], status);
                if (archived)
                    testCase.Archive(actorId, now);
                db.TestCases.Add(testCase);
            }
            for (var i = 0; i < @new; i++) Add(TestCaseStatus.New, false);
            for (var i = 0; i < manual; i++) Add(TestCaseStatus.Manual, false);
            for (var i = 0; i < automatic; i++) Add(TestCaseStatus.Automatic, false);
            for (var i = 0; i < archivedManual; i++) Add(TestCaseStatus.Manual, true);
            return await db.SaveChangesAsync();
        });

    /// <summary>Starts a session over fresh test cases (<c>Results.Length</c> manual + <c>AutomaticCases</c>), records results, attaches bugs and ends it.</summary>
    public static Task AddSessionAsync(this TicketingApiFactory api, Guid projectId, string projectKey, TestUser actor, SessionSeed seed) =>
        api.WithDbAsync(async db =>
        {
            var cases = new List<TestCase>();
            var number = await db.TestCases.CountAsync(c => c.ProjectId == projectId);
            for (var i = 0; i < seed.Results.Length + seed.AutomaticCases; i++)
            {
                var testCase = TestCase.Create(projectId, ++number, $"Case {number}", actor.Id, seed.StartedAt);
                testCase.ChangeStepsAndStatus(["Step"], i < seed.Results.Length ? TestCaseStatus.Manual : TestCaseStatus.Automatic);
                cases.Add(testCase);
            }

            var session = RegressionSession.Start(projectId, projectKey, seed.Number, null, seed.Version, cases, actor.Id, seed.StartedAt);
            foreach (var testCase in cases)
                testCase.Archive(actor.Id, seed.StartedAt);
            db.TestCases.AddRange(cases);

            var manualItems = session.Items.Where(i => i.ExecutionMode == ExecutionMode.Manual).ToList();
            for (var i = 0; i < seed.Results.Length; i++)
            {
                if (seed.Results[i] != RegressionItemStatus.WaitingForExecution)
                    manualItems[i].RecordResult(seed.Results[i], seed.Results[i] == RegressionItemStatus.Failed ? "Broken" : null, actor.Id, seed.StartedAt);
            }

            var failed = manualItems.Where(i => i.Status == RegressionItemStatus.Failed).ToList();
            for (var i = 0; i < seed.BugTicketNumbers.Length; i++)
            {
                var bugNumber = seed.BugTicketNumbers[i];
                failed[i].AttachBug(await db.Tickets.Where(t => t.ProjectId == projectId && t.Number == bugNumber).Select(t => t.Id).SingleAsync());
            }

            if (seed.EndStatus == RegressionSessionStatus.Completed)
                session.Complete(skipRemaining: true, actor.Id, seed.StartedAt.AddHours(1));
            else if (seed.EndStatus == RegressionSessionStatus.Cancelled)
                session.Cancel(actor.Id, seed.StartedAt.AddHours(1));

            db.RegressionSessions.Add(session);
            return await db.SaveChangesAsync();
        });
}
