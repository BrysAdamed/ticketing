namespace Ticketing.IntegrationTests.Infrastructure;

// One collection per feature: each gets its own API host and database, and collections run in parallel.
// A new feature adds its own definition next to its tests, e.g. `public sealed class TicketsCollection : ICollectionFixture<TicketingApiFactory>;`.

[CollectionDefinition(nameof(AuthCollection))]
public sealed class AuthCollection : ICollectionFixture<TicketingApiFactory>;

[CollectionDefinition(nameof(ProjectsCollection))]
public sealed class ProjectsCollection : ICollectionFixture<TicketingApiFactory>;

[CollectionDefinition(nameof(McpCollection))]
public sealed class McpCollection : ICollectionFixture<TicketingApiFactory>;

[CollectionDefinition(nameof(PersistenceCollection))]
public sealed class PersistenceCollection : ICollectionFixture<TicketingApiFactory>;
