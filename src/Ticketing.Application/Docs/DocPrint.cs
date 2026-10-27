using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Attachments;
using Ticketing.Application.Common;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;

namespace Ticketing.Application.Docs;

/// <summary>Who exports, when, in which time zone, and the app's absolute base URL for links that leave the PDF.</summary>
public sealed record DocExportContext(string ExportedBy, DateTimeOffset Now, TimeZoneInfo TimeZone, string AppUrl);

/// <summary>A print bundle for one export and what it holds.</summary>
public sealed record DocPrintJob(PdfRenderRequest Request, string FileName, int Documents);

/// <summary>
/// Builds the print bundle of an export (D-100): the data the print script renders (content, references, embeds, Canvas
/// pictures and page images), resolved for the exporting user with the same filters as the screen, so unreadable tickets,
/// docs and diagrams are simply absent; plus Chromium's header and footer (D-101). Nothing in it points back at the API.
/// </summary>
public static partial class DocPrint
{
    public const int MaxDocuments = 300;
    public const long MaxBytes = 100L * 1024 * 1024;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static async Task<DocPrintJob> BuildAsync(
        ITicketingDbContext db, IProjectAccess access, IAttachmentStore attachments, DocTarget target, int? version, DocExportContext context,
        CancellationToken cancellationToken)
    {
        var projectId = target.ProjectId;
        var projectName = await db.Projects.AsNoTracking().Where(p => p.Id == projectId).Select(p => p.Name).SingleAsync(cancellationToken);
        var folders = await DocQueries.FoldersAsync(db, projectId, includeDeleted: false, cancellationToken);
        var nodes = await db.DocNodes.AsNoTracking()
            .Where(n => n.ProjectId == projectId && n.DeletedAt == null)
            .Select(n => new Node(n.Id, n.ParentId, n.Number, n.Kind, n.DiagramFormat, n.Title, n.Rank, n.CurrentVersion, n.UpdatedAt, n.UpdatedById))
            .ToListAsync(cancellationToken);
        var self = nodes.Single(n => n.Id == target.Id);
        var builder = new Builder(db, access, attachments, target.Grant.ProjectKey, context);

        if (target.Kind == DocKind.Folder)
        {
            if (version is not null)
                throw AppException.Invalid("version", "Folders have no versions; export a folder without version.");
            var subtree = Subtree(nodes, self.Id);
            var documents = subtree.Count(e => e.Node.Kind != DocKind.Folder);
            if (documents > MaxDocuments)
                throw TooLarge(string.Create(CultureInfo.InvariantCulture,
                    $"{target.Key} holds {documents} documents; a PDF export takes at most {MaxDocuments}. Export a subfolder instead."));
            var entries = await builder.FolderEntriesAsync(subtree, folders, cancellationToken);
            var path = DisplayPath(folders, self.ParentId, self.Title);
            var data = builder.Data("folder", projectName, new PrintFolder(target.Key, self.Title, path, documents), entries);
            return builder.Job(data, self.Title, $"{target.Grant.ProjectKey} · {self.Title}", DisplayPath(folders, self.ParentId, null),
                string.Create(CultureInfo.InvariantCulture, $"{target.Key} · {documents} {(documents == 1 ? "document" : "documents")}"),
                target.Grant.Visibility, documents);
        }

        var entry = await builder.SingleEntryAsync(self, target, version, folders, cancellationToken);
        var single = builder.Data("single", projectName, null, [entry]);
        return builder.Job(single, entry.Title, $"{target.Grant.ProjectKey} · {entry.Title}", DisplayPath(folders, self.ParentId, null),
            string.Create(CultureInfo.InvariantCulture, $"{entry.Key} v{entry.Version}"), target.Grant.Visibility, 1);
    }

    /// <summary>The subtree under <paramref name="rootId"/>, depth-first in each folder's manual order, with depths (children are 1).</summary>
    private static List<(Node Node, int Depth)> Subtree(List<Node> nodes, Guid rootId)
    {
        var children = nodes.ToLookup(n => n.ParentId);
        var result = new List<(Node, int)>();
        void Walk(Guid parentId, int depth)
        {
            foreach (var child in children[parentId].OrderBy(n => n.Rank, StringComparer.Ordinal).ThenBy(n => n.Id))
            {
                result.Add((child, depth));
                if (child.Kind == DocKind.Folder && depth <= DocTreeShape.MaxDepth)
                    Walk(child.Id, depth + 1);
            }
        }
        Walk(rootId, 1);
        return result;
    }

    /// <summary>A path for people: the titles from the root joined by " / ", unescaped.</summary>
    private static string DisplayPath(DocFolderIndex folders, Guid? parentId, string? title) =>
        string.Join(" / ", folders.Breadcrumb(parentId, string.Empty).Select(c => c.Title).Concat(title is null ? [] : [title]));

    public static AppException TooLarge(string message) =>
        new(ErrorKind.Validation, DocErrors.ExportTooLarge, message, "Export a smaller folder, or single pages.");

    private sealed record Node(
        Guid Id, Guid? ParentId, int Number, DocKind Kind, DiagramFormat? DiagramFormat, string Title, string Rank, int CurrentVersion,
        DateTimeOffset UpdatedAt, Guid UpdatedById);

    private sealed class Builder(ITicketingDbContext db, IProjectAccess access, IAttachmentStore attachments, string projectKey, DocExportContext context)
    {
        private readonly List<PdfFile> _files = [];
        private readonly Dictionary<Guid, string?> _images = [];
        private readonly Dictionary<(Guid, int), string?> _pictures = [];
        private HashSet<string> _exported = [];
        private long _bytes;

        public async Task<PrintEntry> SingleEntryAsync(
            Node node, DocTarget target, int? version, DocFolderIndex folders, CancellationToken cancellationToken)
        {
            _exported = [target.Key];

            string title, author, content;
            int number;
            DateTimeOffset at;
            if (version is { } n)
            {
                var v = await GetDocVersion.LoadAsync(db, target, n, cancellationToken);
                (title, author, content, number, at) = (v.Title, v.Author.DisplayName, v.Content ?? string.Empty, v.Number, v.CreatedAt);
            }
            else
            {
                var id = node.Id;
                var row = await db.DocNodes.AsNoTracking().Where(x => x.Id == id)
                    .Select(x => new { x.Content, Author = db.Users.Where(u => u.Id == x.UpdatedById).Select(u => u.DisplayName).Single() })
                    .SingleAsync(cancellationToken);
                (title, author, content, number, at) = (node.Title, row.Author, row.Content ?? string.Empty, node.CurrentVersion, node.UpdatedAt);
            }
            return await EntryAsync(node with { Title = title }, 0, number, author, at, content, DisplayPath(folders, node.ParentId, title), cancellationToken, olderVersion: version is not null);
        }

        public async Task<List<PrintEntry>> FolderEntriesAsync(List<(Node Node, int Depth)> subtree, DocFolderIndex folders, CancellationToken cancellationToken)
        {
            _exported = [.. subtree.Select(e => Key(e.Node.Number))];
            var ids = subtree.Where(e => e.Node.Kind != DocKind.Folder).Select(e => e.Node.Id).ToList();
            var rows = await db.DocNodes.AsNoTracking()
                .Where(n => ids.Contains(n.Id))
                .Select(n => new { n.Id, n.Content, Author = db.Users.Where(u => u.Id == n.UpdatedById).Select(u => u.DisplayName).Single() })
                .ToDictionaryAsync(n => n.Id, cancellationToken);
            var entries = new List<PrintEntry>(subtree.Count);
            foreach (var (node, depth) in subtree)
            {
                var path = DisplayPath(folders, node.ParentId, node.Title);
                if (node.Kind == DocKind.Folder)
                {
                    entries.Add(new PrintEntry(
                        Key(node.Number), node.Kind, null, node.Title, depth, 0, path, string.Empty, string.Empty, null, null,
                        PrintReferences.Empty, new Dictionary<string, string>()));
                    continue;
                }
                var row = rows[node.Id];
                entries.Add(await EntryAsync(node, depth, node.CurrentVersion, row.Author, node.UpdatedAt, row.Content ?? string.Empty, path, cancellationToken));
            }
            return entries;
        }

        private async Task<PrintEntry> EntryAsync(
            Node node, int depth, int version, string author, DateTimeOffset at, string content, string path, CancellationToken cancellationToken,
            bool olderVersion = false)
        {
            var key = Key(node.Number);
            var (references, embeds) = olderVersion
                ? await DocReferenceQueries.ReferencesOfContentAsync(db, access, node.Id, content, node.Kind, node.DiagramFormat, cancellationToken)
                : await DocReferenceQueries.ReferencesAsync(db, access, node.Id, content, node.Kind, node.DiagramFormat, cancellationToken);
            var canvas = node.Kind == DocKind.Diagram && node.DiagramFormat == DiagramFormat.Canvas;
            var picture = canvas ? await PictureAsync(node.Id, node.Number, version, cancellationToken) : null;
            var printEmbeds = new List<PrintEmbed>(embeds.Count);
            foreach (var embed in embeds)
            {
                var embedPicture = embed.DiagramFormat == DiagramFormat.Canvas
                    ? await PictureAsync(embed.Id, NumberOf(embed.Key), embed.Version, cancellationToken)
                    : null;
                printEmbeds.Add(new PrintEmbed(embed.Key, embed.Title, embed.DiagramFormat, embed.Version, DocUrl(embed.Key, embed.Url), embed.Content, embedPicture));
            }
            var printReferences = new PrintReferences(
                [.. references.Tickets.Select(t => new PrintTicketReference(t.Key, t.Title, t.Status, Absolute(t.Url)))],
                [.. references.Docs.Select(d => new PrintDocReference(d.Key, d.Title, d.Deleted, d.Url is null ? null : DocUrl(d.Key, d.Url)))],
                printEmbeds);
            var images = node.Kind == DocKind.Page ? await ImagesAsync(content, cancellationToken) : new Dictionary<string, string>();
            return new PrintEntry(
                key, node.Kind, node.DiagramFormat, node.Title, depth, version, path, author, Date(at), canvas ? null : content, picture,
                printReferences, images);
        }

        public PrintData Data(string mode, string projectName, PrintFolder? folder, IReadOnlyList<PrintEntry> entries) =>
            new(mode, context.AppUrl, projectKey, projectName, context.ExportedBy, Stamp(context.Now), folder, entries);

        public DocPrintJob Job(PrintData data, string title, string headerLeft, string headerRight, string footerCentre, ProjectVisibility visibility, int documents)
        {
            var json = JsonSerializer.Serialize(data, Json).Replace("<", "\\u003c", StringComparison.Ordinal);
            var index = $"""
                <!doctype html>
                <html lang="en"><head><meta charset="utf-8"><title>{Html(title)}</title><link rel="stylesheet" href="print.css"></head>
                <body><main></main>
                <script type="application/json" id="tk-print-data">{json}</script>
                <script src="print.js"></script></body></html>
                """;
            var exported = $"Exported {Stamp(context.Now)} by {context.ExportedBy}"
                + (visibility == ProjectVisibility.Private ? " · Private project" : string.Empty);
            var header = Band($"<span>{Html(Truncate(headerLeft, 70))}</span><span>{Html(Truncate(headerRight, 60, fromStart: true))}</span>");
            var footer = Band(
                $"<span>{Html(exported)}</span><span>{Html(footerCentre)}</span>"
                + "<span>Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></span>");
            var date = context.Now.ToOffset(context.TimeZone.GetUtcOffset(context.Now)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var fileName = DocTitles.FileName($"{projectKey}-{title}-{date}", projectKey, ".pdf");
            return new DocPrintJob(new PdfRenderRequest(index, header, footer, _files), fileName, documents);
        }

        private async Task<string?> PictureAsync(Guid nodeId, int number, int version, CancellationToken cancellationToken)
        {
            if (_pictures.TryGetValue((nodeId, version), out var known))
                return known;
            var svg = await db.DocVersions.AsNoTracking()
                .Where(v => v.NodeId == nodeId && v.Number == version)
                .Select(v => v.SnapshotSvg)
                .SingleOrDefaultAsync(cancellationToken);
            var name = svg is null ? null : Add(string.Create(CultureInfo.InvariantCulture, $"canvas-{number}-v{version}.svg"), Encoding.UTF8.GetBytes(svg));
            _pictures[(nodeId, version)] = name;
            return name;
        }

        private async Task<Dictionary<string, string>> ImagesAsync(string content, CancellationToken cancellationToken)
        {
            var images = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (Match match in AttachmentImage().Matches(content))
            {
                if (!Guid.TryParse(match.Groups["id"].Value, out var id))
                    continue;
                var url = AttachmentQueries.Url(id);
                if (images.ContainsKey(url))
                    continue;
                if (await ImageAsync(id, cancellationToken) is { } file)
                    images[url] = file;
            }
            return images;
        }

        private async Task<string?> ImageAsync(Guid id, CancellationToken cancellationToken)
        {
            if (_images.TryGetValue(id, out var known))
                return known;
            string? name = null;
            try
            {
                var attachment = await AttachmentQueries.ReadAsync(db, access, id, cancellationToken);
                if (ImageExtension(attachment.ContentType) is { } extension)
                {
                    await using var stream = await attachments.OpenReadAsync(id, cancellationToken);
                    if (stream is not null)
                    {
                        using var buffer = new MemoryStream();
                        await stream.CopyToAsync(buffer, cancellationToken);
                        name = Add(string.Create(CultureInfo.InvariantCulture, $"image-{_files.Count + 1}{extension}"), buffer.ToArray());
                    }
                }
            }
            catch (AppException)
            {
                name = null;
            }
            _images[id] = name;
            return name;
        }

        private string Add(string name, byte[] content)
        {
            _bytes += content.Length;
            if (_bytes > MaxBytes)
                throw TooLarge("The export's diagrams and images exceed 100 MB.");
            _files.Add(new PdfFile(name, content));
            return name;
        }

        private string Key(int number) => Domain.Common.HumanKeys.Doc(projectKey, number);

        private static int NumberOf(string key) => int.Parse(key[(key.LastIndexOf('-') + 1)..], CultureInfo.InvariantCulture);

        private string DocUrl(string key, string url) => _exported.Contains(key) ? $"#{key}" : Absolute(url);

        private string Absolute(string url) => url.StartsWith('/') ? context.AppUrl + url : url;

        private string Local(DateTimeOffset value) => value.ToOffset(context.TimeZone.GetUtcOffset(value)).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);

        private string Date(DateTimeOffset value) => Local(value)[..10];

        private string Stamp(DateTimeOffset value) =>
            Local(value) + (context.TimeZone == TimeZoneInfo.Utc ? " UTC" : string.Empty);

        private static string? ImageExtension(string contentType) => contentType switch
        {
            "image/png" => ".png",
            "image/jpeg" => ".jpg",
            "image/gif" => ".gif",
            "image/webp" => ".webp",
            _ => null,
        };

        private static string Html(string text) =>
            text.Replace("&", "&amp;", StringComparison.Ordinal).Replace("<", "&lt;", StringComparison.Ordinal)
                .Replace(">", "&gt;", StringComparison.Ordinal).Replace("\"", "&quot;", StringComparison.Ordinal);

        private static string Truncate(string text, int max, bool fromStart = false) =>
            text.Length <= max ? text : fromStart ? "…" + text[^(max - 1)..] : text[..(max - 1)] + "…";

        private static string Band(string content) => $$"""
            <!doctype html><html><head><meta charset="utf-8"><style>
            .band { box-sizing: border-box; width: 100%; padding: 0 18mm; display: flex; gap: 16px;
              font-family: 'DejaVu Sans', sans-serif; font-size: 8px; color: #62656e; -webkit-print-color-adjust: exact; }
            .band > span { flex: 1 1 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .band > span:last-child { text-align: right; }
            .band > span:nth-child(2):not(:last-child) { text-align: center; }
            </style></head><body><div class="band">{{content}}</div></body></html>
            """;
    }

    [GeneratedRegex(@"/api/v1/attachments/(?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})")]
    private static partial Regex AttachmentImage();

    private sealed record PrintData(
        string Mode, string AppUrl, string ProjectKey, string ProjectName, string ExportedBy, string ExportedAt, PrintFolder? Folder,
        IReadOnlyList<PrintEntry> Entries);

    private sealed record PrintFolder(string Key, string Title, string Path, int Documents);

    private sealed record PrintEntry(
        string Key, DocKind Kind, DiagramFormat? DiagramFormat, string Title, int Depth, int Version, string Path, string UpdatedBy,
        string UpdatedAt, string? Content, string? Picture, PrintReferences References, IReadOnlyDictionary<string, string> Images);

    private sealed record PrintReferences(
        IReadOnlyList<PrintTicketReference> Tickets, IReadOnlyList<PrintDocReference> Docs, IReadOnlyList<PrintEmbed> Embeds)
    {
        public static readonly PrintReferences Empty = new([], [], []);
    }

    private sealed record PrintTicketReference(string Key, string Title, TicketStatus Status, string Url);

    private sealed record PrintDocReference(string Key, string? Title, bool Deleted, string? Url);

    private sealed record PrintEmbed(
        string Key, string Title, DiagramFormat DiagramFormat, int Version, string Url, string? Content, string? Picture);
}
