using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Ticketing.Application.Common;

public static class DbErrors
{
    /// <summary>True when the save failed on a unique index, optionally a specific one (by database name, for example <c>ix_projects_key</c>).</summary>
    public static bool IsUniqueViolation(this DbUpdateException exception, string? indexName = null) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } postgres
        && (indexName is null || postgres.ConstraintName == indexName);
}
