namespace Ticketing.Application.Docs;

/// <summary>
/// Full-text search plumbing for docs. The stored generated column (title weight A; content of pages and Mermaid, or the
/// Canvas outline, weight B) is a shadow property, queried as
/// <c>EF.Property&lt;NpgsqlTsVector&gt;(n, DocSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(DocSearch.Configuration, text))</c>.
/// Partial words use the trigram index on title.
/// </summary>
public static class DocSearch
{
    public const string VectorProperty = "SearchVector";
    public const string Configuration = "english";
}
