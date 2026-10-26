using System.Net;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Search;

[Collection(nameof(SearchCollection))]
public sealed class ExportTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Export_streams_the_filtered_sorted_result_as_csv_with_scalar_fields_and_labels()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        await api.SeedTicketsAsync(web, me.Id,
            new SeedTicket("=HYPERLINK(\"http://evil\")", TicketType.Bug) { Labels = ["ui", "backend"], Version = "1.2", Severity = Severity.Major, AssigneeId = me.Id },
            new SeedTicket("Plain, with comma") { Description = "Line one\nLine \"two\"", Status = TicketStatus.Done },
            new SeedTicket("Filtered out", TicketType.Epic));
        var client = await api.LoginAsync(me);

        // Act
        var response = await client.GetAsync("/api/v1/tickets/search/export.csv?type=Bug,UserStory&sort=key", _ct);
        var bytes = await response.Content.ReadAsByteArrayAsync(_ct);
        var text = System.Text.Encoding.UTF8.GetString(bytes);

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal("text/csv", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.DispositionType);
        Assert.EndsWith(".csv", response.Content.Headers.ContentDisposition?.FileName?.Trim('"'), StringComparison.Ordinal);
        Assert.Equal([0xEF, 0xBB, 0xBF], bytes[..3]);
        var lines = text.TrimStart('﻿').Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("Key,Project,Project name,Title,Type,Status,Resolution,Priority,Severity,Story points,Version,Labels,", lines[0], StringComparison.Ordinal);
        Assert.StartsWith("WEB-1,WEB,WEB project,\"'=HYPERLINK(\"\"http://evil\"\")\",Bug,ToDo,,Medium,Major,,1.2,backend;ui,", lines[1], StringComparison.Ordinal);
        Assert.Contains(me.Email, lines[1], StringComparison.Ordinal);
        Assert.StartsWith("WEB-2,WEB,WEB project,\"Plain, with comma\",UserStory,Done,Done,", lines[2], StringComparison.Ordinal);
        Assert.Contains("\"Line one\nLine \"\"two\"\"\"", text, StringComparison.Ordinal);
        Assert.DoesNotContain("Filtered out", text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Export_is_capped_at_ten_thousand_rows_and_rejects_invalid_filters()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var web = await api.SeedProjectAsync("WEB", me);
        await api.BulkSeedTicketsAsync(web, me.Id, 10_005);
        var client = await api.LoginAsync(me);

        // Act
        var csv = await client.GetStringAsync("/api/v1/tickets/search/export.csv", _ct);
        var total = (await client.SearchAsync("limit=1")).Total;
        var invalid = await client.GetAsync("/api/v1/tickets/search/export.csv?priority=Urgent", _ct);

        // Assert
        Assert.Equal(10_001, csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Length);
        Assert.Equal(10_000, total);
        await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
    }
}
