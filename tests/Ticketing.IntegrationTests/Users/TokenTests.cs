using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Application.Tokens;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Maintenance;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[Collection(nameof(TokensCollection))]
public sealed class TokenTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Created_token_is_shown_once_works_as_the_user_and_only_its_hash_is_stored()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var session = await api.LoginAsync(user);

        // Act
        var created = await (await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "Claude Code", scope = "ReadOnly", expiresInDays = 30 }, _ct))
            .ReadAsync<CreatedPatDto>(HttpStatusCode.Created);
        var me = await (await api.CreateBearerClient(created.Secret).GetAsync("/api/v1/me", _ct)).ReadAsync<CurrentUserDto>();
        var listed = await (await session.GetAsync("/api/v1/me/tokens", _ct)).ReadAsync<List<PatDto>>();

        // Assert
        Assert.Matches("^tkt_[0-9A-Za-z]{40}$", created.Secret);
        Assert.Equal(created.Secret[..12], created.Token.Prefix);
        Assert.Equal((PatScope.ReadOnly, PatStatus.Active), (created.Token.Scope, created.Token.Status));
        Assert.InRange(created.Token.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(29.9), TimeSpan.FromDays(30));
        Assert.Equal(user.Id, me.Id);
        Assert.Equal(created.Token.Id, Assert.Single(listed).Id);
        var stored = await api.WithDbAsync(db => db.PersonalAccessTokens.SingleAsync(_ct));
        Assert.NotEqual(created.Secret, stored.TokenHash);
        var audit = await api.WithDbAsync(db => db.ActivityEntries.Select(a => a.NewValue).ToListAsync(_ct));
        Assert.DoesNotContain(audit, json => json != null && json.Contains(created.Secret[4..], StringComparison.Ordinal));
    }

    [Fact]
    public async Task Default_expiry_is_90_days_and_custom_dates_are_capped_at_365_days()
    {
        // Arrange
        var session = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var byDefault = await (await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "default" }, _ct)).ReadAsync<CreatedPatDto>(HttpStatusCode.Created);
        var custom = await (await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "custom", expiresAt = DateTimeOffset.UtcNow.AddDays(200) }, _ct))
            .ReadAsync<CreatedPatDto>(HttpStatusCode.Created);
        var tooFar = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "far", expiresAt = DateTimeOffset.UtcNow.AddDays(366) }, _ct);
        var past = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "past", expiresAt = DateTimeOffset.UtcNow.AddDays(-1) }, _ct);
        var oddPreset = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "odd", expiresInDays = 45 }, _ct);
        var both = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "both", expiresInDays = 7, expiresAt = DateTimeOffset.UtcNow.AddDays(7) }, _ct);

        // Assert
        Assert.InRange(byDefault.Token.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(89.9), TimeSpan.FromDays(90));
        Assert.Equal(PatScope.ReadWrite, byDefault.Token.Scope);
        Assert.InRange(custom.Token.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(199.9), TimeSpan.FromDays(200));
        await tooFar.ShouldBeProblemAsync(HttpStatusCode.BadRequest, PatErrors.ExpiryInvalid);
        await past.ShouldBeProblemAsync(HttpStatusCode.BadRequest, PatErrors.ExpiryInvalid);
        await oddPreset.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await both.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }

    [Fact]
    public async Task Names_are_unique_among_unrevoked_tokens_case_insensitively()
    {
        // Arrange
        var session = await api.LoginAsync(await api.CreateUserAsync());
        var first = await (await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "Laptop" }, _ct)).ReadAsync<CreatedPatDto>(HttpStatusCode.Created);

        // Act
        var duplicate = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "laptop" }, _ct);
        await (await session.PostAsync($"/api/v1/me/tokens/{first.Token.Id}/revoke", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var afterRevoke = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "laptop" }, _ct);

        // Assert
        await duplicate.ShouldBeProblemAsync(HttpStatusCode.Conflict, PatErrors.NameTaken);
        await afterRevoke.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    [Fact]
    public async Task A_user_has_at_most_20_active_tokens()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var session = await api.LoginAsync(user);
        for (var i = 0; i < PersonalAccessToken.MaxActivePerUser; i++)
            await api.CreatePatAsync(user);

        // Act
        var response = await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "one too many" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, PatErrors.LimitReached);
    }

    [Fact]
    public async Task Revoking_is_immediate_and_others_tokens_are_404()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var session = await api.LoginAsync(owner);
        var created = await (await session.PostAsJsonAsync("/api/v1/me/tokens", new { name = "ci" }, _ct)).ReadAsync<CreatedPatDto>(HttpStatusCode.Created);
        var stranger = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var byStranger = await stranger.PostAsync($"/api/v1/me/tokens/{created.Token.Id}/revoke", null, _ct);
        var revoked = await (await session.PostAsync($"/api/v1/me/tokens/{created.Token.Id}/revoke", null, _ct)).ReadAsync<PatDto>();
        var again = await session.PostAsync($"/api/v1/me/tokens/{created.Token.Id}/revoke", null, _ct);
        var use = await api.CreateBearerClient(created.Secret).GetAsync("/api/v1/me", _ct);

        // Assert
        await byStranger.ShouldBeProblemAsync(HttpStatusCode.NotFound, PatErrors.NotFound);
        Assert.Equal(PatStatus.Revoked, revoked.Status);
        await again.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await use.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        Assert.Equal(1, await api.ActivityCountAsync("pat.revoked"));
    }

    [Fact]
    public async Task Tokens_cannot_manage_tokens()
    {
        // Arrange
        var user = await api.CreateUserAsync(GlobalRole.Admin);
        var pat = await api.CreatePatClientAsync(user);

        // Act
        var list = await pat.GetAsync("/api/v1/me/tokens", _ct);
        var create = await pat.PostAsJsonAsync("/api/v1/me/tokens", new { name = "from a token" }, _ct);
        var adminList = await pat.GetAsync("/api/v1/admin/tokens", _ct);

        // Assert
        await list.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await create.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
        await adminList.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "auth.cookieSessionRequired");
    }

    [Fact]
    public async Task Admins_list_every_users_tokens_by_status_and_revoke_any()
    {
        // Arrange
        var adminUser = await api.CreateUserAsync(GlobalRole.Admin);
        var admin = await api.LoginAsync(adminUser);
        var alice = await api.CreateUserAsync();
        var bob = await api.CreateUserAsync();
        var aliceToken = await api.CreatePatAsync(alice);
        await api.CreatePatAsync(bob);
        await api.CreatePatAsync(bob);
        var user = await api.LoginAsync(alice);

        // Act
        var page1 = await (await admin.GetAsync("/api/v1/admin/tokens?limit=2", _ct)).ReadAsync<CursorPage<AdminPatDto>>();
        var page2 = await (await admin.GetAsync($"/api/v1/admin/tokens?limit=2&cursor={page1.NextCursor}", _ct)).ReadAsync<CursorPage<AdminPatDto>>();
        var aliceTokens = await (await admin.GetAsync($"/api/v1/admin/tokens?userId={alice.Id}", _ct)).ReadAsync<CursorPage<AdminPatDto>>();
        var revoked = await (await admin.PostAsync($"/api/v1/admin/tokens/{aliceTokens.Items[0].Id}/revoke", null, _ct)).ReadAsync<PatDto>();
        var revokedList = await (await admin.GetAsync("/api/v1/admin/tokens?status=Revoked", _ct)).ReadAsync<CursorPage<AdminPatDto>>();
        var nonAdmin = await user.GetAsync("/api/v1/admin/tokens", _ct);
        var use = await api.CreateBearerClient(aliceToken).GetAsync("/api/v1/me", _ct);

        // Assert
        Assert.Equal(3, page1.Items.Count + page2.Items.Count);
        Assert.Null(page2.NextCursor);
        Assert.Equal(alice.Email, Assert.Single(aliceTokens.Items).User.Email);
        Assert.Equal(PatStatus.Revoked, revoked.Status);
        Assert.Equal(revoked.Id, Assert.Single(revokedList.Items).Id);
        await nonAdmin.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "forbidden");
        await use.ShouldHaveStatusAsync(HttpStatusCode.Unauthorized);
        var revokedBy = await api.WithDbAsync(db => db.PersonalAccessTokens.Where(t => t.Id == revoked.Id).Select(t => t.RevokedById).SingleAsync(_ct));
        Assert.Equal(adminUser.Id, revokedBy);
    }

    [Fact]
    public async Task Expired_tokens_are_listed_as_expired()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var session = await api.LoginAsync(user);
        await api.WithDbAsync(async db =>
        {
            var created = DateTimeOffset.UtcNow.AddDays(-10);
            db.PersonalAccessTokens.Add(PersonalAccessToken.Create(user.Id, "old", PatScope.ReadOnly, "tkt_oldtoken", new string('a', 64), created.AddDays(7), created));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var listed = await (await session.GetAsync("/api/v1/me/tokens", _ct)).ReadAsync<List<PatDto>>();

        // Assert
        Assert.Equal(PatStatus.Expired, Assert.Single(listed).Status);
    }

    [Fact]
    public async Task Retention_purges_tokens_ended_over_90_days_ago_and_expired_idempotency_records()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var now = DateTimeOffset.UtcNow;
        await api.WithDbAsync(async db =>
        {
            var longAgo = now.AddDays(-200);
            var expiredLongAgo = PersonalAccessToken.Create(user.Id, "expired-long-ago", PatScope.ReadOnly, "tkt_aaaaaaaa", new string('1', 64), longAgo.AddDays(30), longAgo);
            var revokedLongAgo = PersonalAccessToken.Create(user.Id, "revoked-long-ago", PatScope.ReadOnly, "tkt_bbbbbbbb", new string('2', 64), now.AddDays(100), now.AddDays(-150));
            revokedLongAgo.Revoke(user.Id, now.AddDays(-91));
            var revokedRecently = PersonalAccessToken.Create(user.Id, "revoked-recently", PatScope.ReadOnly, "tkt_cccccccc", new string('3', 64), now.AddDays(100), now.AddDays(-150));
            revokedRecently.Revoke(user.Id, now.AddDays(-89));
            var expiredRecently = PersonalAccessToken.Create(user.Id, "expired-recently", PatScope.ReadOnly, "tkt_dddddddd", new string('4', 64), now.AddDays(-80), now.AddDays(-100));
            var active = PersonalAccessToken.Create(user.Id, "active", PatScope.ReadOnly, "tkt_eeeeeeee", new string('5', 64), now.AddDays(10), now);
            db.PersonalAccessTokens.AddRange(expiredLongAgo, revokedLongAgo, revokedRecently, expiredRecently, active);
            db.IdempotencyRecords.Add(Domain.Idempotency.IdempotencyRecord.Create(user.Id, "old-key", "x", "hash", "{}", now.AddDays(-2)));
            db.IdempotencyRecords.Add(Domain.Idempotency.IdempotencyRecord.Create(user.Id, "fresh-key", "x", "hash", "{}", now));
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        RetentionResult result;
        await using (var scope = api.Services.CreateAsyncScope())
            result = await scope.ServiceProvider.GetRequiredService<DataRetention>().PurgeAsync(_ct);

        // Assert
        Assert.Equal(new RetentionResult(2, 1), result);
        var remaining = await api.WithDbAsync(db => db.PersonalAccessTokens.Select(t => t.Name).OrderBy(n => n).ToListAsync(_ct));
        Assert.Equal(["active", "expired-recently", "revoked-recently"], remaining);
        Assert.Equal(["fresh-key"], await api.WithDbAsync(db => db.IdempotencyRecords.Select(r => r.Key).ToListAsync(_ct)));
    }
}
