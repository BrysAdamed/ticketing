using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Common;

namespace Ticketing.Domain.Tests.Collaboration;

public sealed class NotificationPreferencesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 31, 9, 0, 0, TimeSpan.Zero);
    private static readonly Guid Project = Guid.CreateVersion7();
    private static readonly Guid Other = Guid.CreateVersion7();

    [Fact]
    public void New_preferences_silence_nothing()
    {
        // Act
        var preferences = NotificationPreferences.Create(Guid.CreateVersion7(), Now);

        // Assert
        Assert.All(Enum.GetValues<NotificationKind>(), kind => Assert.False(preferences.Silences(kind, Project)));
    }

    [Fact]
    public void A_muted_kind_is_silenced_in_every_project()
    {
        // Arrange
        var preferences = NotificationPreferences.Create(Guid.CreateVersion7(), Now);

        // Act
        preferences.Change([NotificationKind.Mentioned], [], [], [], Now);

        // Assert
        Assert.True(preferences.Silences(NotificationKind.Mentioned, Project));
        Assert.True(preferences.Silences(NotificationKind.Mentioned, Other));
        Assert.False(preferences.Silences(NotificationKind.Commented, Project));
    }

    [Theory]
    [InlineData(NotificationKind.Commented, true)]
    [InlineData(NotificationKind.StatusChanged, true)]
    [InlineData(NotificationKind.PriorityRaised, true)]
    [InlineData(NotificationKind.Moved, true)]
    [InlineData(NotificationKind.Deleted, true)]
    [InlineData(NotificationKind.Mentioned, false)]
    [InlineData(NotificationKind.Assigned, false)]
    [InlineData(NotificationKind.RegressionItemAssigned, false)]
    public void A_muted_project_silences_everything_but_direct_kinds(NotificationKind kind, bool silenced)
    {
        // Arrange
        var preferences = NotificationPreferences.Create(Guid.CreateVersion7(), Now);

        // Act
        preferences.Change([], [], [Project], [], Now);

        // Assert
        Assert.Equal(silenced, preferences.Silences(kind, Project));
        Assert.False(preferences.Silences(kind, Other));
    }

    [Fact]
    public void Changes_are_sets_and_move_the_update_time()
    {
        // Arrange
        var preferences = NotificationPreferences.Create(Guid.CreateVersion7(), Now);
        preferences.Change([NotificationKind.Moved, NotificationKind.Commented], [], [Project], [], Now);

        // Act
        preferences.Change([NotificationKind.Moved], [NotificationKind.Commented, NotificationKind.Deleted], [Project, Other], [Guid.CreateVersion7()], Now.AddMinutes(1));

        // Assert
        Assert.Equal([NotificationKind.Moved], preferences.MutedKinds);
        Assert.Equal([Project, Other], preferences.MutedProjectIds);
        Assert.Equal(Now.AddMinutes(1), preferences.UpdatedAt);
    }

    [Fact]
    public void At_most_200_projects_can_be_muted_but_unmuting_in_the_same_change_makes_room()
    {
        // Arrange
        var preferences = NotificationPreferences.Create(Guid.CreateVersion7(), Now);
        var full = Enumerable.Range(0, NotificationPreferences.MaxMutedProjects).Select(_ => Guid.CreateVersion7()).ToList();
        preferences.Change([], [], full, [], Now);

        // Act
        var error = Assert.Throws<DomainException>(() => preferences.Change([], [], [Project], [], Now));
        preferences.Change([], [], [Project], [full[0]], Now);

        // Assert
        Assert.Equal(CollaborationErrors.MutedProjectLimit, error.Code);
        Assert.Equal(NotificationPreferences.MaxMutedProjects, preferences.MutedProjectIds.Count);
        Assert.Contains(Project, preferences.MutedProjectIds);
    }

    [Fact]
    public void Unknown_kinds_are_rejected()
    {
        // Arrange
        var preferences = NotificationPreferences.Create(Guid.CreateVersion7(), Now);

        // Act and Assert
        Assert.Throws<ArgumentOutOfRangeException>(() => preferences.Change([(NotificationKind)99], [], [], [], Now));
    }
}
