using Ticketing.Application.Agents;
using Ticketing.Infrastructure.Persistence;

namespace Ticketing.Api;

/// <summary>Runs migrations, the bootstrap Admin and the built-in agent prompts before the server accepts requests; a failure stops the host. Register it first so it starts before the Data Protection key ring loads from the database.</summary>
internal sealed class DatabaseStartup(IServiceScopeFactory scopes) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<DatabaseInitializer>().InitializeAsync(cancellationToken);
        await scope.ServiceProvider.GetRequiredService<AgentPromptDefaults>().EnsureAsync(cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
