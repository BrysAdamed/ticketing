using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Collaboration;

namespace Ticketing.Application.Collaboration;

/// <summary>
/// The users that texts of one project mention, for display (D-96): only active users who can read the project, so a client
/// renders every other mention as plain text. One query for all the texts of a response.
/// </summary>
internal static class MentionedUsers
{
    private static readonly IReadOnlyDictionary<Guid, UserRefDto> None = new Dictionary<Guid, UserRefDto>();

    public static async Task<IReadOnlyDictionary<Guid, UserRefDto>> LoadAsync(
        ITicketingDbContext db, Guid projectId, IEnumerable<string?> texts, CancellationToken cancellationToken)
    {
        var ids = texts.SelectMany(Mentions.UserIds).Distinct().ToList();
        if (ids.Count == 0)
            return None;

        return await ProjectReaders.Of(db, projectId).AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new UserRefDto(u.Id, u.Email, u.DisplayName, u.IsActive))
            .ToDictionaryAsync(u => u.Id, cancellationToken);
    }

    /// <summary>The users of <paramref name="users"/> that <paramref name="text"/> mentions, in order of first mention.</summary>
    public static IReadOnlyList<UserRefDto> In(string? text, IReadOnlyDictionary<Guid, UserRefDto> users) =>
        [.. Mentions.UserIds(text).Select(id => users.GetValueOrDefault(id)).OfType<UserRefDto>()];
}
