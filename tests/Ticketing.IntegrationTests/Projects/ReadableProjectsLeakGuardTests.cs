using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Access;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Projects;

/// <summary>
/// The pattern every query over project data must follow (spec 10, "private-project data never leaks"): compose the
/// query with <see cref="IProjectAccess.ReadableProjects"/>. Copy this test for each new list, search, board, hint or
/// statistics query and swap the query under test.
/// </summary>
[Collection(nameof(ProjectsCollection))]
public sealed class ReadableProjectsLeakGuardTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Ticket_queries_composed_with_readable_projects_only_return_visible_tickets()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        await SeedProjectWithTicketAsync("PRIV", ProjectVisibility.Private, owner, member);
        await SeedProjectWithTicketAsync("PUB", ProjectVisibility.Public, owner);
        await SeedProjectWithTicketAsync("GONE", ProjectVisibility.Public, owner, deleted: true);

        // Act
        var asAdmin = await VisibleTicketTitlesAsync(admin);
        var asMember = await VisibleTicketTitlesAsync(member);
        var asOutsider = await VisibleTicketTitlesAsync(outsider);

        // Assert
        Assert.Equal(["PRIV ticket", "PUB ticket"], asAdmin);
        Assert.Equal(["PRIV ticket", "PUB ticket"], asMember);
        Assert.Equal(["PUB ticket"], asOutsider);
    }

    private Task<List<string>> VisibleTicketTitlesAsync(TestUser user) =>
        api.ExecuteAsAsync(user, sp =>
        {
            var db = sp.GetRequiredService<ITicketingDbContext>();
            var access = sp.GetRequiredService<IProjectAccess>();
            return db.Tickets
                .Where(t => t.DeletedAt == null && access.ReadableProjects().Any(p => p.Id == t.ProjectId))
                .OrderBy(t => t.Title)
                .Select(t => t.Title)
                .ToListAsync(_ct);
        });

    private Task<int> SeedProjectWithTicketAsync(string key, ProjectVisibility visibility, TestUser owner, TestUser? member = null, bool deleted = false) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = Project.Create(key, $"{key} project", null, visibility, owner.Id, now);
            if (member is not null)
                project.AddMember(member.Id, ProjectRole.Member, owner.Id, now);
            if (deleted)
            {
                project.Archive(owner.Id, now);
                project.Delete(owner.Id, now, key);
            }
            db.Projects.Add(project);
            db.Tickets.Add(Ticket.Create(project.Id, 1, $"{key} ticket", TicketType.Bug, owner.Id, "a0", now));
            return await db.SaveChangesAsync(_ct);
        });
}
