using Ticketing.Domain.Attachments;

namespace Ticketing.Api.Http;

public static class RequestLimits
{
    /// <summary>
    /// Largest request body Kestrel accepts: a 10 MiB attachment plus multipart framing. The largest JSON body (50 tickets
    /// with full descriptions) stays below it. nginx's <c>client_max_body_size</c> matches.
    /// </summary>
    public const long MaxBodyBytes = Attachment.MaxSizeBytes + (1024 * 1024);
}
