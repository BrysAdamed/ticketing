using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.HttpOverrides;
using Ticketing.Application.Abstractions;

namespace Ticketing.Api.Http;

public sealed class ForwardedHeadersSettings
{
    public const string Section = "ForwardedHeaders";

    /// <summary>
    /// Comma-separated CIDR ranges of proxies whose <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> are believed
    /// (nginx on the compose network). Loopback is always trusted; any other sender's headers are ignored.
    /// </summary>
    public string KnownNetworks { get; set; } = string.Empty;

    /// <summary>How many proxy hops to unwrap, from the right of <c>X-Forwarded-For</c>.</summary>
    public int ForwardLimit { get; set; } = 1;
}

/// <summary>
/// Client address and scheme behind trusted proxies only (D-73), so a client that reaches the API directly cannot pick
/// its rate-limit or lockout partition with a spoofed <c>X-Forwarded-For</c>.
/// </summary>
internal static class ForwardedHeadersSetup
{
    public static IServiceCollection AddTicketingForwardedHeaders(this IServiceCollection services, IConfiguration configuration)
    {
        var settings = configuration.GetSection(ForwardedHeadersSettings.Section).Get<ForwardedHeadersSettings>() ?? new ForwardedHeadersSettings();
        var networks = settings.KnownNetworks
            .Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(ParseNetwork)
            .ToList();
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.ForwardLimit = Math.Max(1, settings.ForwardLimit);
            foreach (var network in networks)
                o.KnownIPNetworks.Add(network);
        });
        services.AddScoped<IClientAddress, HttpClientAddress>();
        return services;
    }

    /// <summary>The remote address as text: IPv4-mapped addresses as IPv4, IPv6 without a zone, <c>unknown</c> when absent.</summary>
    public static string ClientAddress(HttpContext? context)
    {
        if (context?.Connection.RemoteIpAddress is not { } address)
            return "unknown";
        if (address.IsIPv4MappedToIPv6)
            return address.MapToIPv4().ToString();
        return address.AddressFamily == AddressFamily.InterNetworkV6 && address.ScopeId != 0
            ? new IPAddress(address.GetAddressBytes()).ToString()
            : address.ToString();
    }

    private static System.Net.IPNetwork ParseNetwork(string cidr) =>
        System.Net.IPNetwork.TryParse(cidr, out var network)
            ? network
            : throw new InvalidOperationException($"{ForwardedHeadersSettings.Section}:KnownNetworks contains '{cidr}', which is not a CIDR range such as 172.16.0.0/12.");

    private sealed class HttpClientAddress(IHttpContextAccessor accessor) : IClientAddress
    {
        public string Value => ClientAddress(accessor.HttpContext);
    }
}
