using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Search;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.TestCases;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Search;

[CollectionDefinition(nameof(SearchCollection))]
public sealed class SearchCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>A seeded ticket: everything is optional and applied through the domain methods.</summary>
public sealed record SeedTicket(string Title, TicketType Type = TicketType.UserStory)
{
    public string? Description { get; init; }

    public TicketStatus Status { get; init; } = TicketStatus.ToDo;

    public Priority Priority { get; init; } = Priority.Medium;

    public Severity? Severity { get; init; }

    public Guid? AssigneeId { get; init; }

    public Guid? ReporterId { get; init; }

    public string[] Labels { get; init; } = [];

    public string? Version { get; init; }

    public Guid? ParentId { get; init; }

    public Guid? BoardId { get; init; }

    public DateTimeOffset? CreatedAt { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    public bool Deleted { get; init; }
}

/// <summary>Arrange helpers for the search slice. Data goes straight into the database so tests control timestamps and volume.</summary>
public static class SearchTestData
{
    public static Task<Guid> SeedProjectAsync(
        this TicketingApiFactory api, string key, TestUser owner, ProjectVisibility visibility = ProjectVisibility.Private, params (TestUser User, ProjectRole Role)[] members) =>
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

    public static Task<List<Guid>> SeedTicketsAsync(this TicketingApiFactory api, Guid projectId, Guid creatorId, params SeedTicket[] tickets) =>
        api.WithDbAsync(async db =>
        {
            var start = await db.Tickets.Where(t => t.ProjectId == projectId).CountAsync();
            var ids = new List<Guid>();
            for (var i = 0; i < tickets.Length; i++)
            {
                var seed = tickets[i];
                var now = seed.CreatedAt ?? DateTimeOffset.UtcNow.AddMinutes(-tickets.Length + i);
                var ticket = Ticket.Create(projectId, start + i + 1, seed.Title, seed.Type, creatorId, $"a{start + i:D4}", now);
                ticket.ChangeDescription(seed.Description);
                ticket.ChangeStatus(seed.Status, null, now);
                ticket.ChangePriority(seed.Priority);
                ticket.ChangeSeverity(seed.Severity);
                ticket.AssignTo(seed.AssigneeId);
                if (seed.ReporterId is { } reporter)
                    ticket.ChangeReporter(reporter);
                ticket.ReplaceLabels(seed.Labels);
                ticket.ChangeVersion(seed.Version);
                if (seed.BoardId is { } boardId)
                    ticket.PlaceOnBoard(boardId, $"a{start + i:D4}");
                ticket.Touch(seed.UpdatedAt ?? now);
                if (seed.Deleted)
                    ticket.Delete(creatorId, now);
                db.Tickets.Add(ticket);
                ids.Add(ticket.Id);
            }
            await db.SaveChangesAsync();

            for (var i = 0; i < tickets.Length; i++)
            {
                if (tickets[i].ParentId is { } parentId)
                    await db.Tickets.Where(t => t.Id == ids[i]).ExecuteUpdateAsync(s => s.SetProperty(t => t.ParentId, parentId));
            }
            return ids;
        });

    /// <summary>Inserts <paramref name="count"/> varied tickets with one SQL statement (volume and performance tests).</summary>
    public static Task<int> BulkSeedTicketsAsync(this TicketingApiFactory api, Guid projectId, Guid userId, int count, int firstNumber = 1) =>
        api.WithDbAsync(db => db.Database.ExecuteSqlAsync($"""
            INSERT INTO tickets (id, project_id, number, title, description, type, status, resolution, priority, severity, labels, rank,
                                 assignee_id, reporter_id, created_at, created_by_id, updated_at, status_changed_at, resolved_at)
            SELECT gen_random_uuid(), {projectId}, {firstNumber} + g - 1,
                   'Generated ' || (ARRAY['login','checkout','payment','search','report','export','profile','board'])[1 + g % 8] || ' ticket ' || g,
                   CASE WHEN g % 3 = 0 THEN 'The service times out under load in case ' || g END,
                   1 + g % 5, 1 + g % 8, CASE WHEN g % 8 = 7 THEN 1 END, 1 + g % 5, CASE WHEN g % 4 = 0 THEN 1 + g % 5 END,
                   ARRAY['l' || (g % 20)], 'a' || lpad(g::text, 7, '0'),
                   CASE WHEN g % 2 = 0 THEN {userId} END, {userId}, now() - make_interval(mins => g), {userId},
                   now() - make_interval(secs => g), now(), CASE WHEN g % 8 = 7 THEN now() END
            FROM generate_series(1, {count}) AS g
            """));

    /// <summary>Starts a session over one Manual test case and returns (session id, item id).</summary>
    public static Task<(Guid SessionId, Guid ItemId)> SeedRegressionAsync(
        this TicketingApiFactory api, Guid projectId, string projectKey, TestUser starter, Guid? assigneeId, Guid? bugTicketId = null, bool cancelled = false) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var number = await db.TestCases.CountAsync(c => c.ProjectId == projectId) + 1;
            var testCase = TestCase.Create(projectId, number, $"Login works {number}", starter.Id, now);
            testCase.ChangeStepsAndStatus(["Open the login page"], TestCaseStatus.Manual);
            db.TestCases.Add(testCase);
            var sessionNumber = await db.RegressionSessions.CountAsync(s => s.ProjectId == projectId) + 1;
            var session = RegressionSession.Start(projectId, projectKey, sessionNumber, null, "1.0", [testCase], starter.Id, now);
            var item = session.Items[0];
            item.AssignTo(assigneeId);
            if (bugTicketId is { } bug)
            {
                item.RecordResult(RegressionItemStatus.Failed, "Broken", assigneeId ?? starter.Id, now);
                item.AttachBug(bug);
            }
            if (cancelled)
                session.Cancel(starter.Id, now);
            db.RegressionSessions.Add(session);
            await db.SaveChangesAsync();
            return (session.Id, item.Id);
        });

    public static async Task<TicketSearchPage> SearchAsync(this HttpClient client, string query, HttpStatusCode expected = HttpStatusCode.OK) =>
        await (await client.GetAsync($"/api/v1/tickets/search?{query}")).ReadAsync<TicketSearchPage>(expected);

    public static async Task<List<string>> SearchKeysAsync(this HttpClient client, string query) =>
        [.. (await client.SearchAsync(query)).Items.Select(t => t.Key)];

    public static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement;
}
