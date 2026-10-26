/// Cursor-paginated list response (`{ items, nextCursor }`).
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface PageRequest {
  limit?: number;
  cursor?: string | null;
}
