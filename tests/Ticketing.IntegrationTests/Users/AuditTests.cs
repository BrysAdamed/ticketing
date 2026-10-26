using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Audit;
using Ticketing.Application.Common;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(AdminCollection))]
public sealed class AuditTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Audit_lists_admin_actions_newest_first_with_actor_channel_and_labels()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var admin = await api.LoginAsync(adminUser);
        var created = await admin.CreateUserViaAdminAsync(email: "audited@ticketing.test");
        await (await admin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "audited.flag" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);
        await (await admin.PostAsJsonAsync("/api/v1/projects", new { key = "AUD", name = "Audited" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var page = await (await admin.GetAsync("/api/v1/admin/audit", _ct)).ReadAsync<CursorPage<AuditEntryDto>>();

        // Assert
        Assert.Equal(["project.created", "flag.created"], page.Items.Take(2).Select(e => e.Action));
        Assert.Equal(["user.created", "user.setPasswordLink.issued"], page.Items.Skip(2).Select(e => e.Action).Order());
        Assert.All(page.Items, e => Assert.Equal(adminUser.Id, e.Actor!.Id));
        Assert.All(page.Items, e => Assert.Equal(WriteChannel.Web, e.Channel));
        Assert.Equal(["AUD", "audited.flag", "audited@ticketing.test", "audited@ticketing.test"], page.Items.Select(e => e.EntityLabel));
        var userCreated = page.Items.Single(e => e.Action == "user.created");
        Assert.Equal(created.User.Id, userCreated.EntityId);
        Assert.Equal("audited@ticketing.test", userCreated.NewValue!.Value.GetProperty("email").GetString());
        Assert.DoesNotContain(created.SetPasswordLink.Token, page.Items.Select(e => e.NewValue?.GetRawText() ?? string.Empty));
    }

    [Fact]
    public async Task Audit_filters_by_type_action_prefix_actor_and_time_and_pages()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var admin = await api.LoginAsync(adminUser);
        var otherAdminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var otherAdmin = await api.LoginAsync(otherAdminUser);
        var start = DateTimeOffset.UtcNow.AddSeconds(-1);
        await admin.CreateUserViaAdminAsync();
        await admin.CreateUserViaAdminAsync();
        await (await otherAdmin.PostAsJsonAsync("/api/v1/admin/flags", new { key = "by.other" }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var flags = await Get($"/api/v1/admin/audit?entityType=FeatureFlag");
        var userPrefix = await Get("/api/v1/admin/audit?action=user.");
        var exact = await Get("/api/v1/admin/audit?action=user.created");
        var byOther = await Get($"/api/v1/admin/audit?actorId={otherAdminUser.Id}");
        var future = await Get($"/api/v1/admin/audit?from={Uri.EscapeDataString(DateTimeOffset.UtcNow.AddHours(1).ToString("O"))}");
        var since = await Get($"/api/v1/admin/audit?from={Uri.EscapeDataString(start.ToString("O"))}&limit=3");
        var rest = await Get($"/api/v1/admin/audit?from={Uri.EscapeDataString(start.ToString("O"))}&limit=3&cursor={since.NextCursor}");
        var invalidType = await admin.GetAsync("/api/v1/admin/audit?entityType=Ticket", _ct);

        // Assert
        Assert.Equal(["flag.created"], flags.Items.Select(e => e.Action));
        Assert.Equal(4, userPrefix.Items.Count);
        Assert.Equal(2, exact.Items.Count);
        Assert.Equal(["flag.created"], byOther.Items.Select(e => e.Action));
        Assert.Empty(future.Items);
        Assert.Equal(5, since.Items.Count + rest.Items.Count);
        Assert.Null(rest.NextCursor);
        await invalidType.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");

        async Task<CursorPage<AuditEntryDto>> Get(string url) => await (await admin.GetAsync(url, _ct)).ReadAsync<CursorPage<AuditEntryDto>>();
    }

    [Fact]
    public async Task Ticket_history_is_not_part_of_the_audit_trail_and_non_admins_are_refused()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.LoginAsync(await api.CreateUserAsync());
        await api.WithDbAsync(async db =>
        {
            db.ActivityEntries.Add(ActivityEntry.Create(ActivityEntityType.Ticket, Guid.NewGuid(), Guid.NewGuid(), null, null, DateTimeOffset.UtcNow, "ticket.created"));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var page = await (await admin.GetAsync("/api/v1/admin/audit", _ct)).ReadAsync<CursorPage<AuditEntryDto>>();
        var asUser = await user.GetAsync("/api/v1/admin/audit", _ct);

        // Assert
        Assert.Empty(page.Items);
        await asUser.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
    }
}
