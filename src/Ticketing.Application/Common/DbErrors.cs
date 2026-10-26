using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Ticketing.Application.Common;

public static class DbErrors
{
    /// <summary>True when the save failed on a unique index, optionally a specific one (by database name, for example <c>ix_projects_key</c>).</summary>
    public static bool IsUniqueViolation(this DbUpdateException exception, string? indexName = null) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } postgres
        && (indexName is null || postgres.ConstraintName == indexName);

    /// <summary>True when the save failed because a row is still referenced (a restricting foreign key).</summary>
    public static bool IsForeignKeyViolation(this DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation };
}
