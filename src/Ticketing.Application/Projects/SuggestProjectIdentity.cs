using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>
/// The first free name and key for a project the caller is about to create (the "Your first project" walkthrough suggests
/// "&lt;name&gt;'s sandbox"): the name as given, else with " 2", " 3"… appended, and the key as given, else with 2, 3… appended
/// (shortened to fit 10 characters). Names are checked among live projects and keys among every project, deleted ones included
/// (D-10), whether or not the caller can read them, so the suggestion never collides. It reveals no more than a create would.
/// </summary>
public static partial class SuggestProjectIdentity
{
    private const int MaxSuffix = 99;

    public sealed record Query(string Name, string Key) : IValidatable
    {
        public void Validate(Validator validator) => validator
            .Required("name", Name, Project.NameMaxLength)
            .Required("key", Key, Project.KeyMaxLength)
            .Matches("key", Key, KeyPattern(), "Project key must be 2-10 upper-case letters or digits, starting with a letter.");
    }

    /// <summary>A name and a key no project uses; when every suffix up to 99 is taken, the given value is returned as is.</summary>
    public sealed record Result(string Name, string Key);

    public sealed class Handler(ITicketingDbContext db) : IHandler<Query, Result>
    {
        public async Task<Result> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var query = request.EnsureValid() with { Name = request.Name.Trim() };
            var names = NameCandidates(query.Name);
            var normalized = names.Select(n => n.ToLowerInvariant()).ToList();
            var takenNames = await db.Projects
                .AsNoTracking()
                .Where(p => p.DeletedAt == null && normalized.Contains(EF.Property<string>(p, ProjectSchema.NameNormalized)))
                .Select(p => EF.Property<string>(p, ProjectSchema.NameNormalized))
                .ToListAsync(cancellationToken);
            var keys = KeyCandidates(query.Key);
            var takenKeys = await db.Projects
                .AsNoTracking()
                .Where(p => keys.Contains(p.Key))
                .Select(p => p.Key)
                .ToListAsync(cancellationToken);

            var name = names.FirstOrDefault(n => !takenNames.Contains(n.ToLowerInvariant())) ?? query.Name;
            var key = keys.FirstOrDefault(k => !takenKeys.Contains(k)) ?? query.Key;
            return new Result(name, key);
        }
    }

    internal static List<string> NameCandidates(string name)
    {
        var result = new List<string> { name };
        for (var n = 2; n <= MaxSuffix; n++)
        {
            var suffix = " " + n.ToString(CultureInfo.InvariantCulture);
            var stem = name.Length + suffix.Length > Project.NameMaxLength ? name[..(Project.NameMaxLength - suffix.Length)].TrimEnd() : name;
            result.Add(stem + suffix);
        }

        return result;
    }

    internal static List<string> KeyCandidates(string key)
    {
        var result = new List<string> { key };
        for (var n = 2; n <= MaxSuffix; n++)
        {
            var suffix = n.ToString(CultureInfo.InvariantCulture);
            var stem = key.Length + suffix.Length > Project.KeyMaxLength ? key[..(Project.KeyMaxLength - suffix.Length)] : key;
            result.Add(stem + suffix);
        }

        return result;
    }

    [GeneratedRegex("^[A-Z][A-Z0-9]{1,9}$", RegexOptions.CultureInvariant)]
    private static partial Regex KeyPattern();
}
