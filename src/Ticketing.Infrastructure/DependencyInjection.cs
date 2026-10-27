using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Agents;
using Ticketing.Infrastructure.Activity;
using Ticketing.Infrastructure.Attachments;
using Ticketing.Infrastructure.Auth;
using Ticketing.Infrastructure.FeatureFlags;
using Ticketing.Infrastructure.Idempotency;
using Ticketing.Infrastructure.Maintenance;
using Ticketing.Infrastructure.Pdf;
using Ticketing.Infrastructure.Persistence;
using Ticketing.Infrastructure.Time;

namespace Ticketing.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("Db")
            ?? throw new InvalidOperationException("Connection string 'Db' is not configured (ConnectionStrings__Db).");

        services.AddScoped<ActivityObserverInterceptor>();
        services.AddDbContext<TicketingDbContext>((sp, options) =>
            TicketingDbContext.Configure(options, connectionString).AddInterceptors(sp.GetRequiredService<ActivityObserverInterceptor>()));
        services.AddScoped<ITicketingDbContext>(sp => sp.GetRequiredService<TicketingDbContext>());
        services.AddOptions<DatabaseOptions>().Bind(configuration.GetSection(DatabaseOptions.Section));
        services.AddScoped<DatabaseInitializer>();
        services.AddDataProtection().SetApplicationName("ticketing").PersistKeysToDbContext<TicketingDbContext>();

        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<IClock, RequestClock>();
        services.AddMemoryCache();

        services.AddSingleton<IPasswordHasher, PasswordHasherAdapter>();
        services.AddSingleton<IPatTokenGenerator, PatTokenGenerator>();
        services.AddScoped<IAuthenticationStore, AuthenticationStore>();

        services.AddScoped<IProjectCounters, ProjectCounters>();
        services.AddScoped<ITicketRanker, TicketRanker>();
        services.AddScoped<IActivityLog, ActivityLog>();
        services.AddScoped<IAttachmentStore, PostgresAttachmentStore>();
        services.AddScoped<IIdempotency, IdempotencyService>();
        services.AddSingleton<IFeatureFlagStore, FeatureFlagStore>();

        services.AddOptions<AgentOptions>()
            .Configure(o => o.PublicUrl = configuration[AgentOptions.PublicUrlVariable])
            .Validate(o => o.IsValid, $"{AgentOptions.PublicUrlVariable} must be an absolute http or https URL without query, for example https://tickets.example.com.")
            .ValidateOnStart();

        services.AddOptions<PdfOptions>().Bind(configuration.GetSection(PdfOptions.Section));
        services.AddSingleton<PrintBundle>();
        services.AddSingleton<IDocExportLinks, DocExportLinks>();
        services.AddHttpClient<IPdfRenderer, GotenbergPdfRenderer>((sp, client) =>
        {
            client.BaseAddress = new Uri(sp.GetRequiredService<IOptions<PdfOptions>>().Value.Url.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromMinutes(3);
        });
        services.AddHostedService<PdfWarmUp>();

        services.AddOptions<MaintenanceOptions>().Bind(configuration.GetSection(MaintenanceOptions.Section));
        services.AddScoped<DataRetention>();
        services.AddHostedService<DataRetentionService>();
        return services;
    }
}
