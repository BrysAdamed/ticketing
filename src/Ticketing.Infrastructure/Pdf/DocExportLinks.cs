using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;
using Ticketing.Application.Abstractions;

namespace Ticketing.Infrastructure.Pdf;

/// <summary>Export links protected with the app's Data Protection keys (persisted in the database), expiry included.</summary>
internal sealed class DocExportLinks(IDataProtectionProvider provider) : IDocExportLinks
{
    private readonly ITimeLimitedDataProtector _protector =
        provider.CreateProtector("Ticketing.Docs.ExportLink.v1").ToTimeLimitedDataProtector();

    public string Create(DocExportGrant grant, DateTimeOffset expiresAt) =>
        _protector.Protect(
            string.Join('|', grant.UserId.ToString("N"), grant.DocId.ToString("N"),
                grant.Version?.ToString(CultureInfo.InvariantCulture) ?? string.Empty, grant.SecurityStamp),
            expiresAt);

    public DocExportGrant? Read(string token)
    {
        string payload;
        try
        {
            payload = _protector.Unprotect(token, out _);
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
        var parts = payload.Split('|', 4);
        if (parts.Length != 4 || !Guid.TryParseExact(parts[0], "N", out var userId) || !Guid.TryParseExact(parts[1], "N", out var docId))
            return null;
        int? version = null;
        if (parts[2].Length > 0)
        {
            if (!int.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var number))
                return null;
            version = number;
        }
        return new DocExportGrant(userId, docId, version, parts[3]);
    }
}
