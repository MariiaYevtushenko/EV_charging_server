
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type ParsedPagination = {
  page: number;
  pageSize: number;
  skip: number;
};

export function parsePaginationQuery(query: Record<string, unknown>): ParsedPagination {
  const rawPage = Number(query["page"]);
  const rawSize = Number(query["pageSize"]);

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
 
  let pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.floor(rawSize) : DEFAULT_PAGE_SIZE;
  pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  
  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip };
}
