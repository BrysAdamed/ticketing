using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Ticketing.Domain.Comments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Persistence;

public sealed class AddDocWatchersMigrationTests
{
    private const string PreviousMigration = "AddNotificationPreferences";
    private const string Migration = "AddDocWatchers";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Creators_and_authors_of_live_comments_become_watchers_of_pages_and_diagrams()
    {
        // Arrange
        var options = new DbContextOptionsBuilder<TicketingDbContext>();
        TicketingDbContext.Configure(options, await PostgresServer.CreateEmptyDatabaseAsync(_ct));
        await using var db = new TicketingDbContext(options.Options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync(null, _ct);
        var now = DateTimeOffset.UtcNow;
        var author = User.Create("author@ticketing.test", "Author", GlobalRole.User, null, now);
        var commenter = User.Create("commenter@ticketing.test", "Commenter", GlobalRole.User, null, now);
        var quitter = User.Create("quitter@ticketing.test", "Quitter", GlobalRole.User, null, now);
        db.Users.AddRange(author, commenter, quitter);
        var project = Project.Create("MIG", "Migrated", null, ProjectVisibility.Private, author.Id, now);
        db.Projects.Add(project);
        var folder = DocNode.CreateFolder(project.Id, 1, null, "a", "Folder", author.Id, now);
        var page = DocNode.CreateDocument(project.Id, 2, DocKind.Page, null, null, "b", "Page", "Hello", author.Id, now);
        var diagram = DocNode.CreateDocument(project.Id, 3, DocKind.Diagram, DiagramFormat.Mermaid, null, "c", "Flow", "graph TD; A-->B", commenter.Id, now);
        db.DocNodes.AddRange(folder, page, diagram);
        var withdrawn = Comment.CreateForDoc(page.Id, quitter.Id, "Never mind", now);
        withdrawn.Delete(quitter.Id, now);
        db.Comments.AddRange(
            Comment.CreateForDoc(page.Id, commenter.Id, "First", now),
            Comment.CreateForDoc(page.Id, commenter.Id, "Second", now.AddMinutes(1)),
            withdrawn);
        await db.SaveChangesAsync(_ct);
        await migrator.MigrateAsync(PreviousMigration, _ct);

        // Act
        await migrator.MigrateAsync(Migration, _ct);

        // Assert
        var rows = await db.DocWatchers.AsNoTracking().Select(w => new { w.DocNodeId, w.UserId }).ToListAsync(_ct);
        Assert.Equal(
            new[] { (page.Id, author.Id), (page.Id, commenter.Id), (diagram.Id, commenter.Id) }.Order(),
            rows.Select(r => (r.DocNodeId, r.UserId)).Order());
    }
}
