using Ticketing.Domain.Common;
using Ticketing.Domain.Tickets;

namespace Ticketing.Domain.Tests.Tickets;

public sealed class TicketLabelsTests
{
    [Fact]
    public void Labels_are_lower_cased_trimmed_deduplicated_and_sorted()
    {
        // Act
        var labels = TicketLabels.Normalize([" Backend", "backend", "API", "", null, "ui.v2", "a_b-c"]);

        // Assert
        Assert.Equal(["a_b-c", "api", "backend", "ui.v2"], labels);
    }

    [Theory]
    [InlineData("has space")]
    [InlineData("-leading-dash")]
    [InlineData(".dot")]
    [InlineData("ąćę")]
    public void Invalid_labels_are_rejected(string label)
    {
        // Act
        var error = Assert.Throws<DomainException>(() => TicketLabels.Normalize([label]));

        // Assert
        Assert.Equal((TicketErrors.LabelsInvalid, "labels"), (error.Code, error.Field));
    }

    [Fact]
    public void Label_longer_than_50_characters_is_rejected() =>
        Assert.Throws<DomainException>(() => TicketLabels.Normalize([new string('a', 51)]));

    [Fact]
    public void At_most_20_distinct_labels()
    {
        // Arrange
        var twenty = Enumerable.Range(0, 20).Select(i => $"l{i}").ToList();

        // Act / Assert
        Assert.Equal(20, TicketLabels.Normalize([.. twenty, "L0"]).Count);
        Assert.Equal(TicketErrors.LabelsTooMany, Assert.Throws<DomainException>(() => TicketLabels.Normalize([.. twenty, "extra"])).Code);
    }

    [Fact]
    public void Edit_adds_and_removes_case_insensitively()
    {
        // Act
        var labels = TicketLabels.Edit(["api", "backend"], ["UI", "api"], ["BACKEND", "missing"]);

        // Assert
        Assert.Equal(["api", "ui"], labels);
    }

    [Fact]
    public void Edit_still_enforces_the_limit()
    {
        // Arrange
        var twenty = Enumerable.Range(0, 20).Select(i => $"l{i}").ToList();

        // Act / Assert
        Assert.Equal(TicketErrors.LabelsTooMany, Assert.Throws<DomainException>(() => TicketLabels.Edit(twenty, ["extra"], null)).Code);
    }

    [Fact]
    public void Ticket_stores_normalized_labels()
    {
        // Arrange
        var ticket = TicketTests.NewTicket();

        // Act
        ticket.ReplaceLabels(["Regression", "UI"]);

        // Assert
        Assert.Equal(["regression", "ui"], ticket.Labels);
    }
}
