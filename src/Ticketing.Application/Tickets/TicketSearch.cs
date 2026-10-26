namespace Ticketing.Application.Tickets;

/// <summary>
/// Full-text search plumbing for tickets (spec 6.8). The stored generated column is a shadow property, queried as
/// <c>EF.Property&lt;NpgsqlTsVector&gt;(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, text))</c>.
/// Partial words use the trigram index on title: <c>EF.Functions.ILike(t.Title, SqlLike.Contains(text))</c>.
/// </summary>
public static class TicketSearch
{
    public const string VectorProperty = "SearchVector";
    public const string Configuration = "english";
}
