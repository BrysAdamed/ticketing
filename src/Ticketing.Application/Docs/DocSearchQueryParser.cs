using Ticketing.Application.Common;
using Ticketing.Application.Search;
using Ticketing.Domain.Common;
using Ticketing.Domain.Docs;

namespace Ticketing.Application.Docs;

/// <summary>
/// Parses the docs search query string (<c>project, q, kind, folder, mentions, updatedFrom, updatedTo, sort</c>) into
/// <see cref="DocSearchCriteria"/> with the encoding rules of ticket search; every invalid value is reported at once.
/// </summary>
public static class DocSearchQueryParser
{
    public static DocSearchCriteria Parse(IReadOnlyDictionary<string, IReadOnlyList<string?>> query)
    {
        var v = new Validator();
        var parameters = new QueryParameters(query);
        var criteria = new DocSearchCriteria
        {
            ProjectKeys = [.. parameters.List("project").Select(k => k.ToUpperInvariant()).Distinct()],
            Text = parameters.Single("q"),
            Kinds = SearchQueryParser.Enums<DocKind>(v, "kind", parameters.List("kind")),
            Folder = Folder(v, parameters.Single("folder")),
            Mentions = Mentions(v, parameters.Single("mentions")),
            Updated = SearchQueryParser.Range(v, "updated", parameters.Single("updatedFrom"), parameters.Single("updatedTo")),
            Sort = Sort(v, parameters.Single("sort")),
        };

        v.MaxLength("q", criteria.Text, SqlLike.MaxTextLength);
        foreach (var (name, count) in parameters.ListCounts)
            v.Must(count <= SearchQueryParser.MaxListValues, name, $"{name} accepts at most {SearchQueryParser.MaxListValues} values.");
        v.ThrowIfInvalid();
        return criteria;
    }

    private static string? Folder(Validator v, string? value)
    {
        if (value is null)
            return null;
        if (Guid.TryParse(value, out var id))
            return id.ToString();
        if (HumanKeys.TryParseDoc(value, out var projectKey, out var number))
            return HumanKeys.Doc(projectKey, number);
        v.Add("folder", $"'{value}' is not a folder key (for example WEB-D-3) or id.");
        return null;
    }

    private static string? Mentions(Validator v, string? value)
    {
        if (value is null)
            return null;
        if (Guid.TryParse(value, out var id))
            return id.ToString();
        if (HumanKeys.TryParseTicket(value, out var projectKey, out var number))
            return HumanKeys.Ticket(projectKey, number);
        v.Add("mentions", $"'{value}' is not a ticket key or id.");
        return null;
    }

    private static DocSearchSort? Sort(Validator v, string? value)
    {
        if (value is null)
            return null;
        if (Enum.TryParse<DocSearchSort>(value, ignoreCase: true, out var sort) && Enum.IsDefined(sort) && !int.TryParse(value, out _))
            return sort;
        v.Add("sort", "sort must be relevance or updated.");
        return null;
    }
}
