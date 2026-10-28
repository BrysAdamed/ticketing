using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Common;
using Ticketing.Application.Onboarding;
using Ticketing.Domain.Onboarding;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Onboarding;

[CollectionDefinition(nameof(OnboardingCollection))]
public sealed class OnboardingCollection : ICollectionFixture<TicketingApiFactory>;

[Collection(nameof(OnboardingCollection))]
public sealed class OnboardingTests(TicketingApiFactory api)
{
    private const string Onboarding = "/api/v1/me/onboarding";
    private const string Guides = "/api/v1/me/onboarding/guides";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_new_user_has_no_guides_an_empty_checklist_and_their_creation_time()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        var createdAt = await api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.CreatedAt).SingleAsync(_ct));

        // Act
        var onboarding = await (await client.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();

        // Assert
        Assert.Empty(onboarding.Checklist);
        Assert.Empty(onboarding.Guides);
        Assert.False(onboarding.OwnsProjects);
        Assert.Equal(createdAt, onboarding.CreatedAt);
    }

    [Fact]
    public async Task Put_records_a_guide_and_a_second_put_replaces_its_version_and_state()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var first = await (await PutAsync(client, "tour.backlog", 1, GuideState.Dismissed)).ReadAsync<GuideStateDto>();
        var second = await (await PutAsync(client, "tour.backlog", 2, GuideState.Completed)).ReadAsync<GuideStateDto>();
        await (await PutAsync(client, "whats-new.2026-11", 1, GuideState.Completed)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var onboarding = await (await client.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();

        // Assert
        Assert.Equal(("tour.backlog", 1, GuideState.Dismissed), (first.GuideId, first.Version, first.State));
        Assert.Equal(("tour.backlog", 2, GuideState.Completed), (second.GuideId, second.Version, second.State));
        Assert.True(second.UpdatedAt >= first.UpdatedAt);
        Assert.Equal(
            [("tour.backlog", 2, GuideState.Completed), ("whats-new.2026-11", 1, GuideState.Completed)],
            onboarding.Guides.Select(g => (g.GuideId, g.Version, g.State)));
    }

    [Fact]
    public async Task Delete_forgets_every_guide_of_the_caller()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await (await PutAsync(client, "welcome", 1, GuideState.Completed)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await PutAsync(client, "hint.free-transitions", 1, GuideState.Dismissed)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var response = await client.DeleteAsync(Guides, _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        Assert.Empty((await (await client.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>()).Guides);
    }

    [Fact]
    public async Task Owns_projects_is_true_only_for_owners_of_an_active_project()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var archivedOwner = await api.CreateUserAsync();
        var ownerClient = await api.LoginAsync(owner);
        var archivedOwnerClient = await api.LoginAsync(archivedOwner);
        var project = await ownerClient.CreateProjectAsync("ONB");
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        await archivedOwnerClient.CreateProjectAsync("ARC");
        await (await archivedOwnerClient.PostAsync("/api/v1/projects/ARC/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var ownerState = await (await ownerClient.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();
        var memberState = await (await (await api.LoginAsync(member)).GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();
        var archivedOwnerState = await (await archivedOwnerClient.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();

        // Assert
        Assert.True(ownerState.OwnsProjects);
        Assert.False(memberState.OwnsProjects);
        Assert.False(archivedOwnerState.OwnsProjects);
    }

    [Theory]
    [InlineData("Welcome")]
    [InlineData("tour..backlog")]
    [InlineData(".tour")]
    [InlineData("tour.")]
    [InlineData("tour_backlog")]
    [InlineData("-tour")]
    [InlineData("tour--backlog")]
    [InlineData("tour%20backlog")]
    [InlineData("hint%2Fx")]
    public async Task Malformed_guide_ids_are_rejected_with_a_stable_code(string guideId)
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await PutAsync(client, guideId, 1, GuideState.Completed);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, OnboardingErrors.GuideInvalid);
        Assert.True(problem.GetProperty("errors").TryGetProperty("guideId", out _));
    }

    [Fact]
    public async Task A_guide_id_longer_than_100_characters_is_rejected()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var accepted = await PutAsync(client, new string('a', 100), 1, GuideState.Completed);
        var rejected = await PutAsync(client, new string('a', 101), 1, GuideState.Completed);

        // Assert
        await accepted.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await rejected.ShouldBeProblemAsync(HttpStatusCode.BadRequest, OnboardingErrors.GuideInvalid);
    }

    [Theory]
    [InlineData("""{ "version": 0, "state": "Completed" }""", "version")]
    [InlineData("""{ "version": 1000001, "state": "Completed" }""", "version")]
    [InlineData("""{ "state": "Completed" }""", "version")]
    [InlineData("""{ "version": 1 }""", "state")]
    public async Task Invalid_versions_and_states_are_rejected_per_field(string body, string field)
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.PutAsync($"{Guides}/tour.backlog", new StringContent(body, System.Text.Encoding.UTF8, "application/json"), _ct);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        Assert.True(problem.GetProperty("errors").TryGetProperty(field, out _));
    }

    [Fact]
    public async Task An_unknown_state_is_rejected()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var response = await client.PutAsync($"{Guides}/tour.backlog",
            new StringContent("""{ "version": 1, "state": "Seen" }""", System.Text.Encoding.UTF8, "application/json"), _ct);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.BadRequest);
        Assert.Equal(0, await api.WithDbAsync(db => db.UserGuideStates.CountAsync(_ct)));
    }

    [Fact]
    public async Task A_user_can_record_at_most_200_guides_but_can_always_update_a_known_one()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await api.WithDbAsync(db =>
        {
            var now = DateTimeOffset.UtcNow;
            db.UserGuideStates.AddRange(Enumerable.Range(0, UserGuideState.MaxPerUser)
                .Select(i => UserGuideState.Create(user.Id, $"hint.h{i}", 1, GuideState.Completed, now)));
            return db.SaveChangesAsync(_ct);
        });

        // Act
        var newGuide = await PutAsync(client, "tour.backlog", 1, GuideState.Completed);
        var knownGuide = await PutAsync(client, "hint.h7", 2, GuideState.Dismissed);
        await (await client.DeleteAsync(Guides, _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var afterReset = await PutAsync(client, "tour.backlog", 1, GuideState.Completed);

        // Assert
        await newGuide.ShouldBeProblemAsync(HttpStatusCode.Conflict, OnboardingErrors.GuideLimit);
        Assert.Equal(2, (await knownGuide.ReadAsync<GuideStateDto>()).Version);
        await afterReset.ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    [Theory]
    [InlineData(PatScope.ReadWrite)]
    [InlineData(PatScope.ReadOnly)]
    public async Task Personal_access_tokens_can_read_but_not_change_onboarding_state(PatScope scope)
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await (await PutAsync(await api.LoginAsync(user), "welcome", 1, GuideState.Completed)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var pat = await api.CreatePatClientAsync(user, scope);

        // Act
        var get = await pat.GetAsync(Onboarding, _ct);
        var put = await PutAsync(pat, "tour.backlog", 1, GuideState.Completed);
        var delete = await pat.DeleteAsync(Guides, _ct);

        // Assert
        Assert.Equal("welcome", Assert.Single((await get.ReadAsync<OnboardingDto>()).Guides).GuideId);
        await put.ShouldBeProblemAsync(HttpStatusCode.Forbidden, scope == PatScope.ReadOnly ? AppErrors.ReadOnlyToken : AppErrors.CookieSessionRequired);
        await delete.ShouldBeProblemAsync(HttpStatusCode.Forbidden, scope == PatScope.ReadOnly ? AppErrors.ReadOnlyToken : AppErrors.CookieSessionRequired);
        Assert.Equal(1, await api.WithDbAsync(db => db.UserGuideStates.CountAsync(s => s.UserId == user.Id, _ct)));
    }

    [Fact]
    public async Task The_handlers_reject_tokens_outside_rest_too()
    {
        // Arrange
        var user = await api.CreateUserAsync();

        // Act
        var set = await Assert.ThrowsAsync<AppException>(() => api.ExecuteAsAsync(user,
            sp => sp.GetRequiredService<SetGuideState.Handler>().HandleAsync(new SetGuideState.Command(1, GuideState.Completed) { GuideId = "welcome" }, _ct),
            PatScope.ReadWrite));
        var reset = await Assert.ThrowsAsync<AppException>(() => api.ExecuteAsAsync(user,
            sp => sp.GetRequiredService<ResetMyGuides.Handler>().HandleAsync(new ResetMyGuides.Command(), _ct),
            PatScope.ReadWrite));

        // Assert
        Assert.Equal(AppErrors.CookieSessionRequired, set.Code);
        Assert.Equal(AppErrors.CookieSessionRequired, reset.Code);
    }

    [Fact]
    public async Task One_user_never_sees_or_changes_another_users_guides()
    {
        // Arrange
        var alice = await api.LoginAsync(await api.CreateUserAsync());
        var bob = await api.LoginAsync(await api.CreateUserAsync());
        await (await PutAsync(alice, "tour.backlog", 3, GuideState.Completed)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await PutAsync(alice, "welcome", 1, GuideState.Dismissed)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var bobBefore = await (await bob.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();
        await (await PutAsync(bob, "tour.backlog", 1, GuideState.Dismissed)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await bob.DeleteAsync(Guides, _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var aliceAfter = await (await alice.GetAsync(Onboarding, _ct)).ReadAsync<OnboardingDto>();

        // Assert
        Assert.Empty(bobBefore.Guides);
        Assert.Equal(
            [("tour.backlog", 3, GuideState.Completed), ("welcome", 1, GuideState.Dismissed)],
            aliceAfter.Guides.Select(g => (g.GuideId, g.Version, g.State)));
    }

    [Fact]
    public async Task Anonymous_callers_get_401()
    {
        // Arrange
        var client = api.CreateBrowserClient();

        // Act
        var response = await client.GetAsync(Onboarding, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Unauthorized, AppErrors.Unauthenticated);
    }

    private Task<HttpResponseMessage> PutAsync(HttpClient client, string guideId, int version, GuideState state) =>
        client.PutAsJsonAsync($"{Guides}/{guideId}", new { version, state }, HttpAssertions.Json, _ct);
}
