namespace Ticketing.Application.Abstractions;

/// <summary>
/// One use case. Implementations are discovered by assembly scanning and registered as scoped services under their
/// concrete type; REST endpoints and MCP tools inject the concrete handler and call <see cref="HandleAsync"/>.
/// </summary>
public interface IHandler<in TRequest, TResponse>
{
    Task<TResponse> HandleAsync(TRequest request, CancellationToken cancellationToken);
}
