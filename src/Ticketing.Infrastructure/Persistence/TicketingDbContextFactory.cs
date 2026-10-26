using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Ticketing.Infrastructure.Persistence;

/// <summary>Design-time factory for <c>dotnet ef</c>; migrations never need the API host or a live database.</summary>
public sealed class TicketingDbContextFactory : IDesignTimeDbContextFactory<TicketingDbContext>
{
    public TicketingDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<TicketingDbContext>();
        TicketingDbContext.Configure(options, "Host=localhost;Database=ticketing;Username=ticketing;Password=ticketing");
        return new TicketingDbContext(options.Options);
    }
}
