using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Users;

[CollectionDefinition(nameof(UsersCollection))]
public sealed class UsersCollection : ICollectionFixture<TicketingApiFactory>;

[CollectionDefinition(nameof(TokensCollection))]
public sealed class TokensCollection : ICollectionFixture<TicketingApiFactory>;

[CollectionDefinition(nameof(AdminCollection))]
public sealed class AdminCollection : ICollectionFixture<TicketingApiFactory>;
