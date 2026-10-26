using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>
/// Key and name uniqueness: a friendly pre-check against the indexed columns, and the unique indexes as the race-proof
/// backstop, mapped to the same error codes.
/// </summary>
internal static class ProjectUniqueness
{
    public static async Task EnsureKeyIsFreeAsync(ITicketingDbContext db, string key, CancellationToken cancellationToken)
    {
        if (await db.Projects.AnyAsync(p => p.Key == key, cancellationToken))
            throw KeyTaken(key);
    }

    public static async Task EnsureNameIsFreeAsync(ITicketingDbContext db, string name, Guid? exceptProjectId, CancellationToken cancellationToken)
    {
        var normalized = name.ToLowerInvariant();
        if (await db.Projects.AnyAsync(
                p => p.Id != exceptProjectId && p.DeletedAt == null && EF.Property<string>(p, ProjectSchema.NameNormalized) == normalized,
                cancellationToken))
            throw NameTaken(name);
    }

    public static async Task SaveAsync(ITicketingDbContext db, Project project, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (ex.IsUniqueViolation(ProjectSchema.KeyUniqueIndex))
        {
            throw KeyTaken(project.Key);
        }
        catch (DbUpdateException ex) when (ex.IsUniqueViolation(ProjectSchema.NameUniqueIndex))
        {
            throw NameTaken(project.Name);
        }
    }

    private static AppException KeyTaken(string key) =>
        AppException.Conflict(ProjectErrors.KeyTaken, $"The project key {key} is already in use.", "Project keys are unique forever; pick another key.");

    private static AppException NameTaken(string name) =>
        AppException.Conflict(ProjectErrors.NameTaken, $"A project named '{name}' already exists.");
}
