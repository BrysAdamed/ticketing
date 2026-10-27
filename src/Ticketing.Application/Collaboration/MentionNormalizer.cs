using System.Text;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Collaboration;

/// <summary>
/// Prepares a ticket description or comment for saving (D-95): an <c>@email</c> of a user who can read the project becomes a
/// stored mention, newly added mentions are written with the user's current name, and a newly added mention of a user who
/// is unknown, inactive or cannot read the project is rejected with <c>mention.invalid</c>. Mentions (and <c>@email</c>
/// texts) already in the previous text are left as they are, so a user who lost access never blocks an edit. One query.
/// </summary>
public sealed class MentionNormalizer(ITicketingDbContext db)
{
    public async Task<string?> NormalizeAsync(ProjectAccessGrant grant, string? previous, string? text, string field, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(text))
            return text;

        var previousIds = Mentions.UserIds(previous).ToHashSet();
        var previousEmails = Mentions.ParseEmails(previous).Select(e => Address(e.Email)).ToHashSet();
        var tokens = Mentions.Parse(text).Where(t => !previousIds.Contains(t.UserId)).ToList();
        var emails = Mentions.ParseEmails(text).Where(e => !previousEmails.Contains(Address(e.Email))).ToList();
        if (tokens.Count == 0 && emails.Count == 0)
            return text;

        var ids = tokens.Select(t => t.UserId).Distinct().ToList();
        var addresses = emails.Select(e => Address(e.Email)).Distinct().ToList();
        var readers = ProjectReaders.Of(db, grant.ProjectId);
        var users = await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id) || addresses.Contains(u.Email))
            .Select(u => new MentionedUser(u.Id, u.Email, u.DisplayName, readers.Any(r => r.Id == u.Id)))
            .ToListAsync(cancellationToken);
        var byId = users.ToDictionary(u => u.Id);
        var byEmail = users.ToDictionary(u => u.Email);

        var invalid = new List<string>();
        var replacements = new List<(int Start, int Length, string Text)>();
        foreach (var token in tokens)
        {
            if (byId.TryGetValue(token.UserId, out var user) && user.CanRead)
                replacements.Add((token.Start, token.Length, Mentions.Format(user.Id, user.DisplayName)));
            else
                invalid.Add(user is null ? $"user {token.UserId}" : user.DisplayName);
        }
        foreach (var email in emails)
        {
            if (!byEmail.TryGetValue(Address(email.Email), out var user))
                continue;
            if (user.CanRead)
                replacements.Add((email.Start, email.Length, Mentions.Format(user.Id, user.DisplayName)));
            else
                invalid.Add(user.Email);
        }

        if (invalid.Count > 0)
            throw Invalid(grant, field, invalid.Distinct().ToList());
        return Replace(text, replacements);
    }

    private static AppException Invalid(ProjectAccessGrant grant, string field, IReadOnlyList<string> users)
    {
        var message = $"{string.Join(", ", users)} cannot be mentioned: only active users who can read project {grant.ProjectKey} can be mentioned.";
        return new AppException(
            ErrorKind.Validation, CollaborationErrors.MentionInvalid, message,
            $"Only active users who can read project {grant.ProjectKey} can be mentioned.",
            new Dictionary<string, string[]> { [field] = [message] });
    }

    private static string Replace(string text, IEnumerable<(int Start, int Length, string Text)> replacements)
    {
        var result = new StringBuilder(text);
        foreach (var (start, length, value) in replacements.OrderByDescending(r => r.Start))
            result.Remove(start, length).Insert(start, value);
        return result.ToString();
    }

    private static string Address(string email) => email.ToLowerInvariant();

    private sealed record MentionedUser(Guid Id, string Email, string DisplayName, bool CanRead);
}
