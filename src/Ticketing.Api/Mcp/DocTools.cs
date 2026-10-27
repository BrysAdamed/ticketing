using System.ComponentModel;
using Microsoft.AspNetCore.Authorization;
using ModelContextProtocol.Server;
using Ticketing.Api.Auth;
using Ticketing.Application.Attachments;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;

namespace Ticketing.Api.Mcp;

/// <summary>
/// Project docs (spec 1.13): folders, markdown pages and diagrams in a tree per project, addressed by key (<c>WEB-D-12</c>)
/// or by project key and path. Outputs carry raw markdown.
/// </summary>
[McpServerToolType]
public sealed class DocTools
{
    private const string DocKey = "Doc key (for example WEB-D-12) or id.";
    private const string Kinds = "Folder, Page or Diagram";
    private const string Path = @"Titles joined by '/', case-insensitive, for example 'Architecture/ADRs/0001 Use Postgres'; a '/' inside a title is written '\/'.";
    private const string Parent = "Folder key (for example WEB-D-3), folder path, or 'root'.";
    private const string Position = "Top or Bottom (default) of the folder; or use beforeKey/afterKey.";
    private const string DocOutput = "Returns the doc: key, kind, diagramFormat, title, path, parentKey, version (send it back as baseVersion), "
        + "rowVersion, content, updatedAt, updatedBy and url.";
    private const string MermaidTypes = "supported types: flowchart, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, gantt, mindmap";

    [McpServerTool(Name = "list_docs", ReadOnly = true, Idempotent = true, Title = "List docs")]
    [Description("The docs tree of a project as a flat list, depth-first in each folder's manual order: key, kind (" + Kinds + "), diagramFormat, "
        + "title, parentKey, depth (root children are 1), version, childCount, updatedAt. No content: read a doc with get_doc.")]
    public static Task<DocTreeDto> ListDocs(
        GetDocTree.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Only the subtree of this folder: key or path. Default: the whole tree.")] string? folder = null,
        [Description("Levels below the start to list, 1..6 (1 = direct children). Default: all.")] int? depth = null,
        [Description("Only these kinds: " + Kinds + ".")] DocKind[]? kinds = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetDocTree.Query(projectKey, folder, depth, kinds), cancellationToken);

    [McpServerTool(Name = "get_doc", ReadOnly = true, Idempotent = true, Title = "Get doc")]
    [Description("Gets a doc by docKey, or by projectKey and path. Pages return their markdown in content; diagrams their source in content "
        + "(diagramFormat Mermaid: Mermaid text; Canvas: Excalidraw JSON); folders "
        + "list their children. Also: breadcrumb, editors (others with an unpublished draft changed in the last 10 minutes) and permissions. "
        + "Use version as baseVersion for update_doc.")]
    public static Task<DocDto> GetDoc(
        GetDoc.Handler handler,
        [Description(DocKey + " Leave empty when giving projectKey and path.")] string? docKey = null,
        [Description("Project key, with path.")] string? projectKey = null,
        [Description(Path)] string? path = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new GetDoc.Query(docKey, projectKey, path), cancellationToken);

    [McpServerTool(Name = "list_doc_attachments", ReadOnly = true, Idempotent = true, Title = "List doc attachments")]
    [Description("Lists a page's attachments (images and files embedded in its markdown as ![name](url)), oldest first: id, fileName, "
        + "contentType, sizeBytes, uploadedBy, uploadedAt and the download url (relative to the server, needs the same bearer token). "
        + "Read text, CSV and JSON files with get_attachment_text.")]
    public static Task<IReadOnlyList<DocAttachmentDto>> ListDocAttachments(
        ListDocAttachments.Handler handler,
        [Description(DocKey)] string docKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListDocAttachments.Query(docKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_folder", Destructive = false, Title = "Create docs folder")]
    [Description("Creates a folder in a project's docs, in the root or another folder (at most 6 levels, 500 docs per folder). "
        + "Titles are unique within a folder, ignoring case. " + DocOutput)]
    public static Task<DocDto> CreateFolder(
        CreateDoc.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Single-line title, at most 200 characters.")] string title,
        [Description("Parent: " + Parent + " Default: root.")] string? parent = null,
        [Description(Position)] DocPosition? position = null,
        [Description("Place right before this sibling (key or path).")] string? beforeKey = null,
        [Description("Place right after this sibling (key or path).")] string? afterKey = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new CreateDoc.Command(DocKind.Folder, title, parent, position, beforeKey, afterKey, ProjectKeyOrId: projectKey, IdempotencyKey: idempotencyKey),
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_page", Destructive = false, Title = "Create docs page")]
    [Description("Creates a markdown page (version 1) in a project's docs. Markdown is CommonMark + GFM; ticket keys (WEB-42) and doc keys "
        + "(WEB-D-12) become links, [text](WEB-D-12) links with custom text, ```mermaid blocks render as diagrams (" + MermaidTypes + "), "
        + "![caption](WEB-D-12) embeds a diagram doc, GFM alerts (> [!NOTE]) render as callouts. " + DocOutput)]
    public static Task<DocDto> CreatePage(
        CreateDoc.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Single-line title, at most 200 characters, unique within the folder (ignoring case).")] string title,
        [Description("Markdown, at most 100000 characters.")] string? content = null,
        [Description("Parent: " + Parent + " Default: root.")] string? parent = null,
        [Description(Position)] DocPosition? position = null,
        [Description("Place right before this sibling (key or path).")] string? beforeKey = null,
        [Description("Place right after this sibling (key or path).")] string? afterKey = null,
        [Description("Optional 'what changed' note for the version, at most 200 characters.")] string? changeNote = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new CreateDoc.Command(
                DocKind.Page, title, parent, position, beforeKey, afterKey, content, ChangeNote: changeNote, ProjectKeyOrId: projectKey,
                IdempotencyKey: idempotencyKey),
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "create_diagram", Destructive = false, Title = "Create docs diagram")]
    [Description("Creates a diagram doc (version 1) in a project's docs. Prefer format Mermaid for diagrams you write: the source is Mermaid "
        + "text (" + MermaidTypes + "), rendered in the browser with strict security (no click handlers, no HTML labels). Canvas source is the "
        + "visual editor's native Excalidraw JSON, meant for people drawing in the web app. Mermaid source is not validated on the server: check "
        + "the syntax before sending. Pages embed a diagram with ![caption](WEB-D-12). " + DocOutput)]
    public static Task<DocDto> CreateDiagram(
        CreateDoc.Handler handler,
        [Description("Project key, for example WEB.")] string projectKey,
        [Description("Single-line title, at most 200 characters, unique within the folder (ignoring case).")] string title,
        [Description("Mermaid (default) or Canvas.")] DiagramFormat? format = null,
        [Description("The diagram source: Mermaid text (at most 20000 characters) or Canvas JSON. Empty for a blank diagram.")] string? source = null,
        [Description("Parent: " + Parent + " Default: root.")] string? parent = null,
        [Description(Position)] DocPosition? position = null,
        [Description("Place right before this sibling (key or path).")] string? beforeKey = null,
        [Description("Place right after this sibling (key or path).")] string? afterKey = null,
        [Description("Optional 'what changed' note for the version, at most 200 characters.")] string? changeNote = null,
        [Description("Optional key that makes retries safe: a repeat within 24 hours returns the original result.")] string? idempotencyKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new CreateDoc.Command(
                DocKind.Diagram, title, parent, position, beforeKey, afterKey, source, format ?? DiagramFormat.Mermaid, changeNote,
                ProjectKeyOrId: projectKey, IdempotencyKey: idempotencyKey),
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "update_doc", Destructive = false, Title = "Update doc")]
    [Description("Renames a doc and/or replaces its whole content (page markdown, or a diagram's source: Mermaid text for " + MermaidTypes
        + ") as a new version. Replacing content needs baseVersion = the version you read; if someone published since, it fails with "
        + "doc.version.conflict (currentVersion, updatedBy, updatedAt): re-read with get_doc and merge. For small changes to long pages or "
        + "Mermaid diagrams prefer edit_doc. A rename alone creates no version. " + DocOutput)]
    public static Task<DocDto> UpdateDoc(
        UpdateDoc.Handler handler,
        [Description(DocKey)] string docKey,
        [Description("New single-line title.")] string? title = null,
        [Description("The full new content. Omit to keep it.")] string? content = null,
        [Description("Required with content: the version your edit started from.")] int? baseVersion = null,
        [Description("Optional 'what changed' note, at most 200 characters.")] string? changeNote = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(
            new UpdateDoc.Command { KeyOrId = docKey, Title = title, Content = content, BaseVersion = baseVersion, ChangeNote = changeNote },
            cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "edit_doc", Destructive = false, Title = "Edit doc (find/replace)")]
    [Description("Applies 1..50 find/replace edits to the LATEST version of a page or Mermaid diagram, in order, all or nothing, as one new "
        + "version. No baseVersion needed, so it is safe while others edit. Each oldText must match exactly (whitespace and line breaks included) "
        + "and exactly once unless replaceAll: otherwise doc.edit.noMatch or doc.edit.ambiguous, and nothing is changed; re-read with get_doc. "
        + DocOutput)]
    public static Task<DocDto> EditDoc(
        EditDoc.Handler handler,
        [Description(DocKey)] string docKey,
        [Description("The edits: objects { oldText, newText, replaceAll? }.")] DocEdit[] edits,
        [Description("Optional 'what changed' note, at most 200 characters.")] string? changeNote = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new EditDoc.Command(edits, changeNote, docKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "move_doc", Destructive = false, Title = "Move doc")]
    [Description("Moves a doc (a folder with everything in it) to another folder of the same project and/or another position. Fails with "
        + "doc.tree.cycle (into its own subtree), doc.tree.depth (more than 6 levels), doc.tree.folderFull or doc.title.duplicate. " + DocOutput)]
    public static Task<DocDto> MoveDoc(
        MoveDoc.Handler handler,
        [Description(DocKey)] string docKey,
        [Description("Target: " + Parent + " Omit to stay in the current folder (reorder).")] string? parent = null,
        [Description(Position)] DocPosition? position = null,
        [Description("Place right before this sibling in the target folder (key or path).")] string? beforeKey = null,
        [Description("Place right after this sibling in the target folder (key or path).")] string? afterKey = null,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new MoveDoc.Command(parent, position, beforeKey, afterKey, docKey), cancellationToken);

    [Authorize(Policy = AuthPolicies.CanWrite)]
    [McpServerTool(Name = "delete_doc", Destructive = true, Title = "Delete doc")]
    [Description("Deletes a doc; a folder is deleted with everything in it. Owners can delete anything; Members only docs they created, and "
        + "folders only when empty. Returns deletedCount. Undo and the trash are in the web app and REST API, not MCP.")]
    public static Task<DeleteDoc.Result> DeleteDoc(
        DeleteDoc.Handler handler,
        [Description(DocKey)] string docKey,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new DeleteDoc.Command(docKey), cancellationToken);
}
