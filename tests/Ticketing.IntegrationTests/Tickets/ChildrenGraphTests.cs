using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[Collection(nameof(TicketsCollection))]
public sealed class ChildrenGraphTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Graph_has_the_children_external_tickets_links_and_blocked_flags()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        var a = await client.CreateTicketAsync("WEB", "A", extra: new { parentKey = epic.Key });
        var b = await client.CreateTicketAsync("WEB", "B", extra: new { parentKey = epic.Key });
        var c = await client.CreateTicketAsync("WEB", "C", extra: new { parentKey = epic.Key, status = "Done" });
        var lone = await client.CreateTicketAsync("WEB", "Lone", extra: new { parentKey = epic.Key });
        var outside = await client.CreateTicketAsync("WEB", "Outside");
        await LinkAsync(client, a.Key, b.Key, "Blocks");
        await LinkAsync(client, c.Key, a.Key, "Blocks");
        await LinkAsync(client, outside.Key, c.Key, "Blocks");
        await LinkAsync(client, b.Key, outside.Key, "RelatesTo");

        // Act
        var graph = await GetGraphAsync(client, epic.Key);

        // Assert
        Assert.Equal(epic.Key, graph.Key);
        Assert.Equal([a.Key, b.Key, c.Key, lone.Key, outside.Key], graph.Nodes.Select(n => n.Key));
        Assert.Equal([outside.Key], graph.Nodes.Where(n => n.External).Select(n => n.Key));
        Assert.Equal([b.Key], graph.Nodes.Where(n => n.Blocked).Select(n => n.Key));
        Assert.Equal(
            [(TicketLinkType.Blocks, a.Key, b.Key), (TicketLinkType.Blocks, c.Key, a.Key), (TicketLinkType.Blocks, outside.Key, c.Key)],
            graph.Edges.Where(e => e.Type == TicketLinkType.Blocks).Select(e => (e.Type, e.From, e.To)));
        Assert.Single(graph.Edges, e => e.Type == TicketLinkType.RelatesTo);
    }

    [Fact]
    public async Task A_ticket_without_children_has_an_empty_graph()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Alone");
        var other = await client.CreateTicketAsync("WEB", "Other");
        await LinkAsync(client, ticket.Key, other.Key, "Blocks");

        // Act
        var graph = await GetGraphAsync(client, ticket.Key);

        // Assert
        Assert.Empty(graph.Nodes);
        Assert.Empty(graph.Edges);
    }

    [Fact]
    public async Task Viewers_read_the_graph_and_outsiders_of_a_private_project_get_404()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var project = await owner.CreateProjectAsync("WEB");
        var epic = await owner.CreateTicketAsync("WEB", "Epic", "Epic");
        await owner.CreateTicketAsync("WEB", "Child", extra: new { parentKey = epic.Key });
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var viewerGraph = await GetGraphAsync(viewer, epic.Key);
        var outsiderResponse = await outsider.GetAsync($"/api/v1/tickets/{epic.Key}/children/graph", _ct);

        // Assert
        Assert.Single(viewerGraph.Nodes);
        await outsiderResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
    }

    [Fact]
    public async Task Links_to_unreadable_or_deleted_tickets_are_left_out_and_do_not_block()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("SECRET");
        await owner.CreateProjectAsync("OPEN", ProjectVisibility.Public);
        var secret = await owner.CreateTicketAsync("SECRET", "Hidden blocker");
        var epic = await owner.CreateTicketAsync("OPEN", "Epic", "Epic");
        var child = await owner.CreateTicketAsync("OPEN", "Child", extra: new { parentKey = epic.Key });
        var gone = await owner.CreateTicketAsync("OPEN", "Deleted blocker");
        await LinkAsync(owner, secret.Key, child.Key, "Blocks");
        await LinkAsync(owner, gone.Key, child.Key, "Blocks");
        (await owner.DeleteAsync($"/api/v1/tickets/{gone.Key}", _ct)).EnsureSuccessStatusCode();
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var ownerGraph = await GetGraphAsync(owner, epic.Key);
        var outsiderGraph = await GetGraphAsync(outsider, epic.Key);
        var outsiderJson = await (await outsider.GetAsync($"/api/v1/tickets/{epic.Key}/children/graph", _ct)).Content.ReadAsStringAsync(_ct);

        // Assert
        Assert.Equal([child.Key, secret.Key], ownerGraph.Nodes.Select(n => n.Key));
        Assert.True(ownerGraph.Nodes[0].Blocked);
        Assert.Equal([child.Key], outsiderGraph.Nodes.Select(n => n.Key));
        Assert.False(outsiderGraph.Nodes[0].Blocked);
        Assert.Empty(outsiderGraph.Edges);
        Assert.DoesNotContain("SECRET", outsiderJson, StringComparison.Ordinal);
        Assert.DoesNotContain(secret.Id.ToString(), outsiderJson, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Mcp_get_children_graph_uses_the_same_rules()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");
        var epic = await client.CreateTicketAsync("WEB", "Epic", "Epic");
        var a = await client.CreateTicketAsync("WEB", "A", extra: new { parentKey = epic.Key });
        var b = await client.CreateTicketAsync("WEB", "B", extra: new { parentKey = epic.Key });
        await LinkAsync(client, a.Key, b.Key, "Blocks");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));
        await using var outsider = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync()));

        // Act
        var result = await mcp.CallToolAsync("get_children_graph", new Dictionary<string, object?> { ["key"] = epic.Key }, cancellationToken: _ct);
        var hidden = await outsider.CallToolAsync("get_children_graph", new Dictionary<string, object?> { ["key"] = epic.Key }, cancellationToken: _ct);

        // Assert
        Assert.NotEqual(true, result.IsError);
        var payload = Payload(result);
        Assert.Equal(
            [(a.Key, false), (b.Key, true)],
            payload.GetProperty("nodes").EnumerateArray().Select(n => (n.GetProperty("key").GetString(), n.GetProperty("blocked").GetBoolean())));
        var edge = Assert.Single(payload.GetProperty("edges").EnumerateArray().ToList());
        Assert.Equal(("Blocks", a.Key, b.Key), (edge.GetProperty("type").GetString(), edge.GetProperty("from").GetString(), edge.GetProperty("to").GetString()));
        Assert.True(hidden.IsError);
        Assert.EndsWith("notFound", Payload(hidden).GetProperty("code").GetString(), StringComparison.Ordinal);
    }

    private async Task LinkAsync(HttpClient client, string from, string to, string type) =>
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{from}/links", new { targetKey = to, type }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);

    private async Task<TicketGraphDto> GetGraphAsync(HttpClient client, string key) =>
        await (await client.GetAsync($"/api/v1/tickets/{key}/children/graph", _ct)).ReadAsync<TicketGraphDto>();

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
