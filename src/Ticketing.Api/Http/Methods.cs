namespace Ticketing.Api.Http;

internal static class Methods
{
    public static bool IsUnsafe(string method) =>
        !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method) || HttpMethods.IsTrace(method));
}
