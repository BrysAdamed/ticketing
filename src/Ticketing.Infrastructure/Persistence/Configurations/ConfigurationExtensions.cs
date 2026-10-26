using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Ticketing.Infrastructure.Persistence.Configurations;

internal static class ConfigurationExtensions
{
    /// <summary>Maps a <c>uint RowVersion</c> property to PostgreSQL's <c>xmin</c> system column (optimistic concurrency).</summary>
    public static PropertyBuilder<uint> IsXminRowVersion(this PropertyBuilder<uint> property) =>
        property.IsRowVersion().HasColumnName("xmin").HasColumnType("xid");
}
