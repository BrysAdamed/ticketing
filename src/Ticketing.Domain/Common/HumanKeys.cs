using System.Globalization;
using System.Text.RegularExpressions;

namespace Ticketing.Domain.Common;

/// <summary>Formats and parses human keys: tickets <c>WEB-42</c>, test cases <c>WEB-TC-7</c>, regression sessions <c>WEB-R-3</c> (spec 6.1).</summary>
public static partial class HumanKeys
{
    public static string Ticket(string projectKey, int number) => $"{projectKey}-{number.ToString(CultureInfo.InvariantCulture)}";

    public static string TestCase(string projectKey, int number) => $"{projectKey}-TC-{number.ToString(CultureInfo.InvariantCulture)}";

    public static string Regression(string projectKey, int number) => $"{projectKey}-R-{number.ToString(CultureInfo.InvariantCulture)}";

    public static bool TryParseTicket(string? key, out string projectKey, out int number) =>
        TryParse(TicketPattern(), key, out projectKey, out number);

    public static bool TryParseTestCase(string? key, out string projectKey, out int number) =>
        TryParse(TestCasePattern(), key, out projectKey, out number);

    public static bool TryParseRegression(string? key, out string projectKey, out int number) =>
        TryParse(RegressionPattern(), key, out projectKey, out number);

    private static bool TryParse(Regex pattern, string? key, out string projectKey, out int number)
    {
        projectKey = string.Empty;
        number = 0;
        if (key is null)
            return false;
        var match = pattern.Match(key.Trim());
        if (!match.Success || !int.TryParse(match.Groups[2].ValueSpan, NumberStyles.None, CultureInfo.InvariantCulture, out number) || number < 1)
            return false;
        projectKey = match.Groups[1].Value.ToUpperInvariant();
        return true;
    }

    [GeneratedRegex(@"^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$", RegexOptions.CultureInvariant)]
    private static partial Regex TicketPattern();

    [GeneratedRegex(@"^([A-Za-z][A-Za-z0-9]{1,9})-[Tt][Cc]-(\d{1,9})$", RegexOptions.CultureInvariant)]
    private static partial Regex TestCasePattern();

    [GeneratedRegex(@"^([A-Za-z][A-Za-z0-9]{1,9})-[Rr]-(\d{1,9})$", RegexOptions.CultureInvariant)]
    private static partial Regex RegressionPattern();
}
