using System.Net;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using Ticketing.Application.Achievements;
using Ticketing.Application.Docs;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Docs;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The secret criteria of spec 15.4: second-thoughts, unblocker and grand-tour (TKT-96).</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class SecretCriteriaTests(TicketingApiFactory api)
{
    private static readonly string[] Tour = ["InProgress", "OnHold", "Review", "ReadyForTesting", "Testing", "ReadyForDeploy"];

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Second_thoughts_counts_undoing_your_own_delete_of_a_ticket_or_a_doc_on_every_channel()
    {
        // Arrange
        var world = await WorldAsync();
        var overRest = await world.MemberAsync(ProjectRole.Owner);
        var overMcp = await world.MemberAsync(ProjectRole.Owner);
        var docAuthor = await world.MemberAsync(ProjectRole.Member);
        var first = await world.Owner.CreateTicketAsync("WEB", "Deleted by mistake");
        var second = await world.Owner.CreateTicketAsync("WEB", "Deleted over MCP");
        var page = await docAuthor.Client.CreatePageAsync("WEB", "My notes");
        var start = DateTimeOffset.UtcNow;
        await (await overRest.Client.DeleteTicketAsync(first.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await RestoreTicketAsync(overRest.Client, first.Key);
        await overMcp.Mcp.CallOkAsync("delete_ticket", new() { ["key"] = second.Key });
        await RestoreTicketAsync(overMcp.Client, second.Key);
        await docAuthor.Mcp.CallOkAsync("delete_doc", new() { ["docKey"] = page.Key });
        await RestoreDocAsync(docAuthor.Client, page.Key);

        // Act
        var progress = await api.EvaluateAsync(
            [new(overRest.Account.Id, start), new(overMcp.Account.Id, start), new(docAuthor.Account.Id, start), new(world.OwnerAccount.Id, start)],
            [AchievementCatalog.SecondThoughts]);

        // Assert
        Assert.Equal([(1, 1), (1, 1), (1, 1), (0, 0)], new[] { overRest.Account, overMcp.Account, docAuthor.Account, world.OwnerAccount }.Select(u => Of(progress, u)));
    }

    [Fact]
    public async Task Second_thoughts_ignores_someone_elses_delete_a_late_restore_from_the_trash_a_version_restore_and_a_delete_before_the_start()
    {
        // Arrange
        var world = await WorldAsync();
        var deleter = await world.MemberAsync(ProjectRole.Member);
        var restorer = await world.MemberAsync(ProjectRole.Owner);
        var late = await world.MemberAsync(ProjectRole.Owner);
        var versions = await world.MemberAsync(ProjectRole.Member);
        var early = await world.MemberAsync(ProjectRole.Owner);
        var othersPage = await deleter.Client.CreatePageAsync("WEB", "Deleted by its author");
        var trashed = await late.Client.CreatePageAsync("WEB", "Restored from the trash");
        var versioned = await versions.Client.CreatePageAsync("WEB", "Versioned", content: "first");
        var earlyTicket = await world.Owner.CreateTicketAsync("WEB", "Deleted before the start");
        await (await early.Client.DeleteTicketAsync(earlyTicket.Key)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var start = DateTimeOffset.UtcNow;
        (await deleter.Client.DeleteAsync($"/api/v1/docs/{othersPage.Key}", _ct)).EnsureSuccessStatusCode();
        await RestoreDocAsync(restorer.Client, othersPage.Key);
        (await late.Client.DeleteAsync($"/api/v1/docs/{trashed.Key}", _ct)).EnsureSuccessStatusCode();
        await BackdateDeleteAsync(trashed.Id, TimeSpan.FromMinutes(11));
        await RestoreDocAsync(late.Client, trashed.Key);
        (await versions.Client.PatchDocAsync(versioned.Key, new { content = "second", baseVersion = 1 })).EnsureSuccessStatusCode();
        await versions.Mcp.CallOkAsync("restore_doc_version", new() { ["docKey"] = versioned.Key, ["version"] = 1 });
        await RestoreTicketAsync(early.Client, earlyTicket.Key);

        // Act
        var progress = await api.EvaluateAsync(
            [
                new(deleter.Account.Id, start), new(restorer.Account.Id, start), new(late.Account.Id, start.AddHours(-1)),
                new(versions.Account.Id, start), new(early.Account.Id, start),
            ],
            [AchievementCatalog.SecondThoughts]);

        // Assert
        Assert.All(progress, p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    [Fact]
    public async Task Unblocker_counts_a_ticket_moved_to_done_that_still_blocks_three_open_tickets_over_rest_and_mcp()
    {
        // Arrange
        var world = await WorldAsync();
        var overRest = await world.MemberAsync(ProjectRole.Member);
        var overMcp = await world.MemberAsync(ProjectRole.Member);
        var first = await BlockerAsync(world, "ToDo", "InProgress", "Review");
        var second = await BlockerAsync(world, "ToDo", "ToDo", "OnHold", "Done");
        var start = DateTimeOffset.UtcNow;

        // Act
        await overRest.Client.PatchTicketAsync(first, new { status = "Done" });
        await overMcp.Mcp.CallOkAsync("update_ticket", new() { ["key"] = second, ["status"] = "Done" });

        // Assert
        var progress = await api.EvaluateAsync(
            [new(overRest.Account.Id, start), new(overMcp.Account.Id, start), new(world.OwnerAccount.Id, start)], [AchievementCatalog.Unblocker]);
        Assert.Equal([(1, 1), (1, 1), (0, 0)], new[] { overRest.Account, overMcp.Account, world.OwnerAccount }.Select(u => Of(progress, u)));
    }

    [Fact]
    public async Task Unblocker_ignores_too_few_open_blocked_tickets_other_link_directions_reopened_or_deleted_tickets_and_closes_before_the_start()
    {
        // Arrange
        var world = await WorldAsync();
        var oneDone = await world.MemberAsync(ProjectRole.Member);
        var oneDeleted = await world.MemberAsync(ProjectRole.Member);
        var blockedBy = await world.MemberAsync(ProjectRole.Member);
        var relates = await world.MemberAsync(ProjectRole.Member);
        var reopened = await world.MemberAsync(ProjectRole.Member);
        var deletedBlocker = await world.MemberAsync(ProjectRole.Member);
        var early = await world.MemberAsync(ProjectRole.Member);
        var earlyBlocker = await BlockerAsync(world, "ToDo", "ToDo", "ToDo");
        await early.Client.PatchTicketAsync(earlyBlocker, new { status = "Done" });
        var start = DateTimeOffset.UtcNow;
        var withDone = await BlockingAsync(world, "ToDo", "ToDo", "ToDo");
        await oneDone.Client.PatchTicketAsync(withDone.Blocker, new { status = "Done" });
        await world.Owner.PatchTicketAsync(withDone.Blocked[0], new { status = "Done" });
        var withDeleted = await BlockingAsync(world, "ToDo", "ToDo", "ToDo");
        await oneDeleted.Client.PatchTicketAsync(withDeleted.Blocker, new { status = "Done" });
        await (await world.Owner.DeleteTicketAsync(withDeleted.Blocked[0])).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var blocked = (await world.Owner.CreateTicketAsync("WEB", "Blocked by three")).Key;
        var related = (await world.Owner.CreateTicketAsync("WEB", "Related to three")).Key;
        for (var i = 0; i < 3; i++)
        {
            var source = (await world.Owner.CreateTicketAsync("WEB", $"Blocker {i}")).Key;
            await (await world.Owner.LinkAsync(source, blocked, "Blocks")).ShouldHaveStatusAsync(HttpStatusCode.Created);
            await (await world.Owner.LinkAsync(related, (await world.Owner.CreateTicketAsync("WEB", $"Related {i}")).Key)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        }
        await blockedBy.Client.PatchTicketAsync(blocked, new { status = "Done" });
        await relates.Client.PatchTicketAsync(related, new { status = "Done" });
        var reopenedBlocker = await BlockerAsync(world, "ToDo", "ToDo", "ToDo");
        await reopened.Client.PatchTicketAsync(reopenedBlocker, new { status = "Done" });
        await world.Owner.PatchTicketAsync(reopenedBlocker, new { status = "InProgress" });
        var doomed = await BlockerAsync(world, "ToDo", "ToDo", "ToDo");
        await deletedBlocker.Client.PatchTicketAsync(doomed, new { status = "Done" });
        await (await world.Owner.DeleteTicketAsync(doomed)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var progress = await api.EvaluateAsync(
            [.. new[] { oneDone, oneDeleted, blockedBy, relates, reopened, deletedBlocker, early }.Select(m => new AchievementSubject(m.Account.Id, start))],
            [AchievementCatalog.Unblocker]);

        // Assert
        Assert.All(progress, p => Assert.Equal((0, 0), (p.Count, p.Tier)));
    }

    [Fact]
    public async Task Grand_tour_counts_for_everyone_who_moved_a_ticket_that_went_through_all_eight_statuses_on_any_channel()
    {
        // Arrange
        var world = await WorldAsync();
        var guide = await world.MemberAsync(ProjectRole.Member);
        var finisher = await world.MemberAsync(ProjectRole.Member);
        var watcher = await world.MemberAsync(ProjectRole.Member);
        var ticket = (await world.Owner.CreateTicketAsync("WEB", "Around the board")).Key;
        var start = DateTimeOffset.UtcNow;
        foreach (var status in Tour)
            await guide.Client.PatchTicketAsync(ticket, new { status });
        var beforeDone = await api.CountAsync(guide.Account, start, AchievementCatalog.GrandTour);

        // Act
        await finisher.Mcp.CallOkAsync("update_ticket", new() { ["key"] = ticket, ["status"] = "Done" });
        await watcher.Client.PatchTicketAsync(ticket, new { priority = "High" });

        // Assert
        Assert.Equal(0, beforeDone);
        var progress = await api.EvaluateAsync(
            [new(guide.Account.Id, start), new(finisher.Account.Id, start), new(watcher.Account.Id, start), new(world.OwnerAccount.Id, start)],
            [AchievementCatalog.GrandTour]);
        Assert.Equal(
            [(1, 1), (1, 1), (0, 0), (0, 0)],
            new[] { guide.Account, finisher.Account, watcher.Account, world.OwnerAccount }.Select(u => Of(progress, u)));
    }

    [Fact]
    public async Task Grand_tour_counts_only_status_changes_after_the_start_and_only_alive_tickets()
    {
        // Arrange
        var world = await WorldAsync();
        var missedOne = await world.MemberAsync(ProjectRole.Member);
        var early = await world.MemberAsync(ProjectRole.Member);
        var returner = await world.MemberAsync(ProjectRole.Member);
        var deleted = await world.MemberAsync(ProjectRole.Member);
        var partial = (await world.Owner.CreateTicketAsync("WEB", "Left To Do before the start")).Key;
        await world.Owner.PatchTicketAsync(partial, new { status = "InProgress" });
        var returned = (await world.Owner.CreateTicketAsync("WEB", "Back to To Do")).Key;
        await early.Client.PatchTicketAsync(returned, new { status = "InProgress" });
        var start = DateTimeOffset.UtcNow;
        foreach (var status in Tour.Skip(1).Append("Done"))
            await missedOne.Client.PatchTicketAsync(partial, new { status });
        foreach (var status in new[] { "ToDo" }.Concat(Tour.Skip(1)).Append("Done"))
            await returner.Client.PatchTicketAsync(returned, new { status });
        var doomed = (await world.Owner.CreateTicketAsync("WEB", "Toured then deleted")).Key;
        foreach (var status in Tour.Append("Done"))
            await deleted.Client.PatchTicketAsync(doomed, new { status });
        await (await world.Owner.DeleteTicketAsync(doomed)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var progress = await api.EvaluateAsync(
            [.. new[] { missedOne, early, returner, deleted }.Select(m => new AchievementSubject(m.Account.Id, start))],
            [AchievementCatalog.GrandTour]);

        // Assert
        Assert.Equal(
            [(0, 0), (0, 0), (1, 1), (0, 0)],
            new[] { missedOne.Account, early.Account, returner.Account, deleted.Account }.Select(u => Of(progress, u)));
    }

    private static (int Count, int Tier) Of(IReadOnlyList<AchievementProgress> progress, TestUser user) =>
        progress.Where(p => p.UserId == user.Id).Select(p => (p.Count, p.Tier)).Single();

    private static async Task<string> BlockerAsync(World world, params string[] blockedStatuses) =>
        (await BlockingAsync(world, blockedStatuses)).Blocker;

    private static async Task<(string Blocker, List<string> Blocked)> BlockingAsync(World world, params string[] blockedStatuses)
    {
        var blocker = (await world.Owner.CreateTicketAsync("WEB", "Blocker")).Key;
        var blocked = new List<string>();
        foreach (var status in blockedStatuses)
        {
            blocked.Add((await world.Owner.CreateTicketAsync("WEB", $"Blocked, {status}", extra: new { status })).Key);
            await (await world.Owner.LinkAsync(blocker, blocked[^1], "Blocks")).ShouldHaveStatusAsync(HttpStatusCode.Created);
        }
        return (blocker, blocked);
    }

    private async Task RestoreTicketAsync(HttpClient client, string key) =>
        (await client.PostAsync($"/api/v1/tickets/{key}/restore", null, _ct)).EnsureSuccessStatusCode();

    private async Task RestoreDocAsync(HttpClient client, string key) =>
        (await client.PostAsync($"/api/v1/docs/{key}/restore", null, _ct)).EnsureSuccessStatusCode();

    private Task BackdateDeleteAsync(Guid docId, TimeSpan by) =>
        api.WithDbAsync(async db =>
        {
            await db.ActivityEntries.Where(a => a.EntityId == docId && a.Action == DeleteDoc.Action)
                .ExecuteUpdateAsync(s => s.SetProperty(a => a.OccurredAt, a => a.OccurredAt - by), _ct);
            return await db.DocNodes.Where(n => n.Id == docId)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.DeletedAt, n => n.DeletedAt - by), _ct);
        });

    private async Task<World> WorldAsync()
    {
        var ownerAccount = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerAccount);
        var project = await owner.CreateProjectAsync("WEB");
        return new World(api, project.Id, ownerAccount, owner);
    }

    private sealed record World(TicketingApiFactory Api, Guid ProjectId, TestUser OwnerAccount, HttpClient Owner)
    {
        public async Task<Member> MemberAsync(ProjectRole role)
        {
            var account = await Api.CreateUserAsync();
            await Api.AddMemberAsync(ProjectId, account, role);
            return new Member(account, await Api.LoginAsync(account), await Api.CreateMcpClientAsync(await Api.CreatePatAsync(account)));
        }
    }

    private sealed record Member(TestUser Account, HttpClient Client, McpClient Mcp);
}
