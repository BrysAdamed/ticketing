using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Api;

/// <summary>Runs migrations and the bootstrap Admin before the server accepts requests; a failure stops the host. Register it first so it starts before the Data Protection key ring loads from the database.</summary>
internal sealed class DatabaseStartup(IServiceScopeFactory scopes) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
