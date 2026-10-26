using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.FeatureFlags;

namespace Ticketing.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IProjectAccess, ProjectAccess>();
        services.AddScoped<IFeatureFlags, FeatureFlagEvaluator>();
        services.AddHandlers(typeof(DependencyInjection).Assembly);
        return services;
    }

    /// <summary>Registers every concrete <see cref="IHandler{TRequest, TResponse}"/> in the assembly as a scoped service of its own type.</summary>
    public static IServiceCollection AddHandlers(this IServiceCollection services, Assembly assembly)
    {
        var handlers = assembly.GetTypes().Where(t =>
            t is { IsClass: true, IsAbstract: false } &&
            t.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IHandler<,>)));
        foreach (var handler in handlers)
            services.AddScoped(handler);
        return services;
    }
}
