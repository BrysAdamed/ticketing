using System.Linq.Expressions;
using System.Reflection;
using Ticketing.Application.Common;

namespace Ticketing.Application.Search;

/// <summary>
/// Sorting and keyset paging for search results (spec 6.8). Each sort has a unique composite key ending in the id
/// (or project key + number), and the cursor stores that key, so pages never skip or repeat rows.
/// </summary>
internal static class TicketSearchOrdering
{
    private static readonly MethodInfo StringCompare = typeof(string).GetMethod(nameof(string.Compare), [typeof(string), typeof(string)])!;

    public static IOrderedQueryable<TicketSearchRow> OrderBy(IQueryable<TicketSearchRow> rows, TicketSort sort, SortOrder order)
    {
        var desc = order == SortOrder.Desc;
        return sort switch
        {
            TicketSort.Created => rows.Order(r => r.CreatedAt, desc).ThenOrder(r => r.Id, desc),
            TicketSort.Priority => rows.Order(r => r.Priority, desc).ThenOrder(r => r.Id, desc),
            TicketSort.Key => rows.Order(r => r.ProjectKey, desc).ThenOrder(r => r.Number, desc),
            TicketSort.Rank => rows.Order(r => r.Rank, desc).ThenOrder(r => r.Id, desc),
            _ => rows.Order(r => r.UpdatedAt, desc).ThenOrder(r => r.Id, desc),
        };
    }

    public static IQueryable<TicketSearchRow> After(IQueryable<TicketSearchRow> rows, TicketSort sort, SortOrder order, string? cursor)
    {
        var position = Cursor.Decode<SearchCursor>(cursor);
        if (position is null)
            return rows;
        if (position.S != sort || position.O != order)
            throw AppException.Invalid("cursor", "The cursor belongs to a different sort; start again without it.");

        var desc = order == SortOrder.Desc;
        return sort switch
        {
            TicketSort.Created => rows.Where(Seek(desc, (r => r.CreatedAt, Need(position.T)), (r => r.Id, position.I))),
            TicketSort.Priority => rows.Where(Seek(desc, (r => (int)r.Priority, Need(position.N)), (r => r.Id, position.I))),
            TicketSort.Key => rows.Where(Seek(desc, (r => r.ProjectKey, Need(position.K)), (r => r.Number, Need(position.N)))),
            TicketSort.Rank => rows.Where(Seek(desc, (r => r.Rank, Need(position.K)), (r => r.Id, position.I))),
            _ => rows.Where(Seek(desc, (r => r.UpdatedAt, Need(position.T)), (r => r.Id, position.I))),
        };
    }

    public static SearchCursor CursorFor(TicketSearchRow row, TicketSort sort, SortOrder order) => sort switch
    {
        TicketSort.Created => new SearchCursor(sort, order, row.Id, T: row.CreatedAt),
        TicketSort.Priority => new SearchCursor(sort, order, row.Id, N: (int)row.Priority),
        TicketSort.Key => new SearchCursor(sort, order, row.Id, N: row.Number, K: row.ProjectKey),
        TicketSort.Rank => new SearchCursor(sort, order, row.Id, K: row.Rank),
        _ => new SearchCursor(sort, order, row.Id, T: row.UpdatedAt),
    };

    private static T Need<T>(T? value)
        where T : struct => value ?? throw InvalidCursor();

    private static string Need(string? value) => value ?? throw InvalidCursor();

    private static AppException InvalidCursor() => AppException.Invalid("cursor", "The cursor is invalid.");

    private static IOrderedQueryable<T> Order<T, TKey>(this IQueryable<T> query, Expression<Func<T, TKey>> key, bool desc) =>
        desc ? query.OrderByDescending(key) : query.OrderBy(key);

    private static IOrderedQueryable<T> ThenOrder<T, TKey>(this IOrderedQueryable<T> query, Expression<Func<T, TKey>> key, bool desc) =>
        desc ? query.ThenByDescending(key) : query.ThenBy(key);

    /// <summary><c>k1 &gt; v1 OR (k1 = v1 AND k2 &gt; v2)</c> (or &lt; when descending), with the values as SQL parameters.</summary>
    private static Expression<Func<TicketSearchRow, bool>> Seek<T1, T2>(
        bool desc, (Expression<Func<TicketSearchRow, T1>> Key, T1 Value) first, (Expression<Func<TicketSearchRow, T2>> Key, T2 Value) second)
    {
        var row = first.Key.Parameters[0];
        var k1 = first.Key.Body;
        var k2 = new ParameterReplacer(second.Key.Parameters[0], row).Visit(second.Key.Body);
        var v1 = Parameter(first.Value);
        var v2 = Parameter(second.Value);
        var body = Expression.OrElse(
            Beyond(k1, v1, desc),
            Expression.AndAlso(Expression.Equal(k1, v1), Beyond(k2, v2, desc)));
        return Expression.Lambda<Func<TicketSearchRow, bool>>(body, row);
    }

    private static Expression Beyond(Expression key, Expression value, bool desc)
    {
        var type = desc ? ExpressionType.LessThan : ExpressionType.GreaterThan;
        if (key.Type == typeof(string))
            return Expression.MakeBinary(type, Expression.Call(StringCompare, key, value), Expression.Constant(0));
        if (key.Type == typeof(Guid))
            return Expression.MakeBinary(type, Expression.Call(key, typeof(Guid).GetMethod(nameof(Guid.CompareTo), [typeof(Guid)])!, value), Expression.Constant(0));
        return Expression.MakeBinary(type, key, value);
    }

    private static Expression Parameter<T>(T value)
    {
        Expression<Func<T>> closure = () => value;
        return closure.Body;
    }

    private sealed class ParameterReplacer(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}

/// <summary>Serialized into the opaque cursor: the sort it belongs to and the last row's key.</summary>
internal sealed record SearchCursor(TicketSort S, SortOrder O, Guid I, DateTimeOffset? T = null, int? N = null, string? K = null);
