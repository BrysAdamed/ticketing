using System.Net;
using System.Net.Http.Headers;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Ticketing.Application.Abstractions;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// The real pipeline once: the API posts the print bundle to Gotenberg (the image of docker-compose.yml) and gets a PDF back.
/// Opt-in (pulls a 1.7 GB image, needs <c>npm run build:print</c>): <c>TICKETING_PDF_TESTS=1 dotnet test -- --filter-trait "Category=Pdf"</c>.
/// </summary>
[Collection(nameof(DocsCollection))]
[Trait("Category", "Pdf")]
public sealed class DocExportGotenbergTests(TicketingApiFactory api)
{
    private const string Image = "gotenberg/gotenberg:8.39.0-chromium";
    private const string Password = "pdf-test-secret";

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_page_and_a_folder_render_to_pdf_in_gotenberg()
    {
        // Arrange
        Assert.SkipUnless(Environment.GetEnvironmentVariable("TICKETING_PDF_TESTS") == "1", "Set TICKETING_PDF_TESTS=1 to run the Gotenberg test.");
        var bundle = PrintBundlePath();
        Assert.SkipWhen(bundle is null, "Build the print bundle first: cd web && npm run build:print.");
        await using var gotenberg = new ContainerBuilder(Image)
            .WithEnvironment("GOTENBERG_API_BASIC_AUTH_USERNAME", "ticketing")
            .WithEnvironment("GOTENBERG_API_BASIC_AUTH_PASSWORD", Password)
            .WithCommand("gotenberg", "--api-enable-basic-auth", "--api-timeout=120s", "--chromium-allow-list=^file:///tmp/.*",
                "--chromium-deny-private-ips", "--chromium-deny-public-ips", "--chromium-auto-start")
            .WithPortBinding(3000, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(3000).ForPath("/health")))
            .Build();
        await gotenberg.StartAsync(_ct);
        await using var host = api.WithWebHostBuilder(b =>
        {
            b.UseSetting("Pdf:Url", $"http://{gotenberg.Hostname}:{gotenberg.GetMappedPublicPort(3000)}");
            b.UseSetting("Pdf:Password", Password);
            b.UseSetting("Pdf:BundlePath", bundle);
            b.ConfigureTestServices(s => s.Remove(s.Last(d => d.ServiceType == typeof(IPdfRenderer))));
        });
        var client = host.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await api.CreatePatAsync(await api.CreateUserAsync()));
        await client.CreateProjectAsync("GOT");
        var folder = await client.CreateFolderAsync("GOT", "Architecture");
        var flow = await client.CreateDiagramAsync("GOT", "Flow", "Mermaid", "flowchart LR\n  SPA --> API --> DB", folder.Key);
        var page = await client.CreatePageAsync("GOT", "Overview", folder.Key,
            $"## Zażółć gęślą jaźń\n\n> [!NOTE]\n> Rendered offline.\n\n![Flow]({flow.Key})\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```csharp\nvar x = 1;\n```");
        var decisions = await client.CreateFolderAsync("GOT", "Decisions", folder.Key);
        var storage = await client.CreateFolderAsync("GOT", "Storage", decisions.Key);
        await client.CreatePageAsync("GOT", "Use Postgres", storage.Key, "# Why\n\nOne database.\n\n## Trade-offs\n\nNone.");

        // Act
        var single = await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf?tz=Europe/Warsaw", _ct);
        var whole = await client.GetAsync($"/api/v1/docs/{folder.Key}/export.pdf", _ct);

        // Assert
        var pdfs = new List<byte[]>();
        foreach (var response in new[] { single, whole })
        {
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var pdf = await response.Content.ReadAsByteArrayAsync(_ct);
            Assert.Equal("%PDF"u8.ToArray(), pdf[..4]);
            Assert.True(pdf.Length > 10_000, $"Suspiciously small PDF: {pdf.Length} bytes.");
            pdfs.Add(pdf);
        }
        Assert.Equal(["Overview", "Overview / Zażółć gęślą jaźń"], PdfOutline.Paths(pdfs[0]));
        var bookmarks = PdfOutline.Paths(pdfs[1]);
        Assert.Contains("Overview / Zażółć gęślą jaźń", bookmarks);
        Assert.Contains("Flow", bookmarks);
        Assert.Contains("Decisions / Storage / Use Postgres / Why / Trade-offs", bookmarks);
    }

    private static string? PrintBundlePath()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "web", "dist", "print");
            if (File.Exists(Path.Combine(candidate, "print.js")))
                return candidate;
        }
        return null;
    }
}
