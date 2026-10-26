using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Tokens;

namespace Ticketing.Application.Access;

public static class CurrentUserExtensions
{
    /// <summary>Rejects writes made with a ReadOnly PAT (spec 5.5). Call in every write handler that is not project-scoped.</summary>
    public static void EnsureWriteScope(this ICurrentUser user)
    {
        if (user.PatScope == PatScope.ReadOnly)
            throw AppException.Forbidden(AppErrors.ReadOnlyToken, "This token is read-only.", "Create a ReadWrite token to make changes.");
    }

    /// <summary>Rejects personal access tokens for actions that only the web session may perform (PATs, passwords, users, flags).</summary>
    public static void EnsureCookieSession(this ICurrentUser user)
    {
        if (user.PatId is not null)
            throw AppException.Forbidden(AppErrors.CookieSessionRequired, "This action is only available in the web application.");
    }

    public static void EnsureAdmin(this ICurrentUser user)
    {
        if (!user.IsAdmin)
            throw AppException.Forbidden(AppErrors.Forbidden, "Only administrators can do this.");
    }
}
