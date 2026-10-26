using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Boards;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Boards;

/// <summary>Spec 5.4, 6.5 and 10: cards, counts and linked projects of private projects never leak through board reads.</summary>
[Collection(nameof(BoardsCollection))]
public sealed class BoardLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Shared_board_shows_each_viewer_only_cards_counts_and_projects_they_can_read()
    {
        // Arrange
        var (board, member, outsider, admin) = await SeedSharedBoardAsync();

        // Act
        var asMember = await member.GetBoardAsync(board);
        var asOutsider = await outsider.GetBoardAsync(board);
        var asAdmin = await admin.GetBoardAsync(board);
        var listedForOutsider = (await (await outsider.GetAsync("/api/v1/boards", _ct)).ReadAsync<CursorPage<BoardSummaryDto>>()).Items.Single();
        var listedForMember = (await (await member.GetAsync("/api/v1/boards", _ct)).ReadAsync<CursorPage<BoardSummaryDto>>()).Items.Single();

        // Assert
        Assert.Equal(["ToDo: PUB-1, PRIV-1", "Done: PRIV-2"], asMember.Layout());
        Assert.Equal(["ToDo: PUB-1"], asOutsider.Layout());
        Assert.Equal(["ToDo: PUB-1, PRIV-1", "Done: PRIV-2"], asAdmin.Layout());
        Assert.Equal(["PRIV", "PUB"], asMember.Projects.Select(p => p.Key));
        Assert.Equal(["PUB"], asOutsider.Projects.Select(p => p.Key));
        Assert.DoesNotContain(asOutsider.Parents, p => p.Key.StartsWith("PRIV", StringComparison.Ordinal));
        Assert.Equal(new StatusCategoryCountsDto(1, 0, 0), listedForOutsider.Counts);
        Assert.Equal(["PUB"], listedForOutsider.Projects.Select(p => p.Key));
        Assert.Equal(new StatusCategoryCountsDto(2, 0, 1), listedForMember.Counts);
    }

    [Fact]
    public async Task Filtering_boards_by_an_unreadable_project_is_404_and_deleted_projects_vanish()
    {
        // Arrange
        var (board, member, outsider, _) = await SeedSharedBoardAsync();
        await api.WithDbAsync(async db =>
        {
            var project = await db.Projects.SingleAsync(p => p.Key == "PRIV", _ct);
            project.Archive(project.CreatedById, DateTimeOffset.UtcNow);
            project.Delete(project.CreatedById, DateTimeOffset.UtcNow, project.Key);
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var byPrivate = await outsider.GetAsync("/api/v1/boards?projectKey=PRIV", _ct);
        var asMember = await member.GetBoardAsync(board);

        // Assert
        await byPrivate.ShouldBeProblemAsync(System.Net.HttpStatusCode.NotFound, ProjectErrors.NotFound);
        Assert.Equal(["ToDo: PUB-1"], asMember.Layout());
        Assert.Equal(["PUB"], asMember.Projects.Select(p => p.Key));
    }

    private async Task<(Guid Board, HttpClient Member, HttpClient Outsider, HttpClient Admin)> SeedSharedBoardAsync()
    {
        var owner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var priv = await ownerClient.CreateProjectAsync("PRIV");
        await ownerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        var memberUser = await api.CreateUserAsync();
        await api.AddMemberAsync(priv.Id, memberUser, ProjectRole.Member);
        var board = await ownerClient.CreateBoardAsync("Shared", "PUB", "PRIV");
        var parent = await ownerClient.CreateTicketAsync("PRIV", "Secret parent", "Epic");
        var child = await ownerClient.CreateTicketAsync("PRIV", "Secret child", extra: new { parentKey = parent.Key, status = "Done" });
        var pub = await ownerClient.CreateTicketAsync("PUB", "Public card");
        await ownerClient.MoveOkAsync(board.Id.ToString(), [pub.Key, parent.Key, child.Key]);
        return (board.Id, await api.LoginAsync(memberUser), await api.LoginAsync(await api.CreateUserAsync()), await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin)));
    }
}
