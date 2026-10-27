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
}
