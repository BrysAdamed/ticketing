using Microsoft.EntityFrameworkCore;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Ordering;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

/// <summary>Arranges projects, boards and tickets directly in the database for the project slice tests.</summary>
internal static class ProjectSeed
{
    public static Task<Guid> ProjectAsync(
        this TicketingApiFactory api, TestUser owner, string key, ProjectVisibility visibility = ProjectVisibility.Private,
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

    public static Task<Guid> BoardAsync(this TicketingApiFactory api, TestUser owner, string name, params Guid[] projectIds) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var board = Board.Create(name, null, owner.Id, now);
            foreach (var projectId in projectIds)
                board.LinkProject(projectId, owner.Id, now);
            db.Boards.Add(board);
            await db.SaveChangesAsync();
            return board.Id;
        });

    /// <summary>Adds tickets in the given order; each container gets ascending ranks in that order.</summary>
    public static Task<int> TicketsAsync(
        this TicketingApiFactory api, Guid projectId, TestUser reporter, params (string Title, Guid? BoardId, TicketStatus Status)[] tickets) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var number = await db.Tickets.CountAsync(t => t.ProjectId == projectId) + 1;
            var ranks = FractionalIndex.NKeysBetween(null, null, tickets.Length);
            for (var i = 0; i < tickets.Length; i++)
            {
                var (title, boardId, status) = tickets[i];
                var ticket = Ticket.Create(projectId, number++, title, TicketType.Technical, reporter.Id, ranks[i], now);
                if (boardId is { } board)
                    ticket.PlaceOnBoard(board, ranks[i]);
                ticket.ChangeStatus(status, null, now);
                db.Tickets.Add(ticket);
            }
            return await db.SaveChangesAsync();
        });

    public static Task<int> DeactivateAsync(this TicketingApiFactory api, TestUser user) =>
        api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == user.Id)).Deactivate(Guid.CreateVersion7(), DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync();
        });
}
