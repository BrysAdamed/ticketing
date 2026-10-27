namespace Ticketing.Domain.Docs;

public static class DocErrors
{
    public const string NotFound = "doc.notFound";
    public const string Deleted = "doc.deleted";
    public const string NotDeleted = "doc.notDeleted";
    public const string KindUnsupported = "doc.kind.unsupported";
    public const string FormatInvalid = "doc.diagramFormat.invalid";
    public const string ParentInvalid = "doc.parent.invalid";
    public const string TitleDuplicate = "doc.title.duplicate";
    public const string TreeDepth = "doc.tree.depth";
    public const string TreeCycle = "doc.tree.cycle";
    public const string FolderFull = "doc.tree.folderFull";
    public const string ProjectLimit = "doc.project.limit";
    public const string ContentTooLong = "doc.content.tooLong";
    public const string BaseVersionRequired = "doc.baseVersion.required";
    public const string BaseVersionInvalid = "doc.baseVersion.invalid";
    public const string VersionConflict = "doc.version.conflict";
    public const string VersionNotFound = "doc.version.notFound";
    public const string EditNoMatch = "doc.edit.noMatch";
    public const string EditAmbiguous = "doc.edit.ambiguous";
    public const string RankAnchorInvalid = "doc.rank.anchor";
    public const string DeleteForbidden = "doc.delete.forbidden";
    public const string FolderNotEmpty = "doc.folder.notEmpty";
    public const string RestoreForbidden = "doc.restore.forbidden";
    public const string RestoreExpired = "doc.restore.expired";
    public const string DraftNotFound = "doc.draft.notFound";
    public const string DiagramInvalidSource = "doc.diagram.invalidSource";
    public const string DiagramEmbeddedFiles = "doc.diagram.embeddedFiles";
    public const string DiagramTooManyElements = "doc.diagram.tooManyElements";
    public const string SnapshotInvalid = "doc.snapshot.invalid";
    public const string SnapshotNotFound = "doc.snapshot.notFound";
    public const string ExportBusy = "doc.export.busy";
    public const string ExportTooLarge = "doc.export.tooLarge";
    public const string ExportUnavailable = "doc.export.unavailable";
    public const string ExportFailed = "doc.export.failed";
    public const string ExportTimeout = "doc.export.timeout";
}
