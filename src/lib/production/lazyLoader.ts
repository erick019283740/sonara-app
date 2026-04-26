/**
 * Lazy Loading Utilities
 * 
 * Helps implement pagination and chunked loading for large datasets.
 */

export interface PaginationOptions {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export async function fetchPaginated<T>(
  fetchFn: (options: PaginationOptions) => Promise<{ data: T[]; total: number }>,
  options: PaginationOptions
): Promise<PaginatedResult<T>> {
  const { data, total } = await fetchFn(options);
  const hasMore = (options.page + 1) * options.pageSize < total;

  return {
    data,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      hasMore,
    },
  };
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function validatePagination(
  page: number | string,
  pageSize: number | string
): PaginationOptions {
  const parsedPage = typeof page === "string" ? parseInt(page, 10) : page;
  const parsedPageSize = typeof pageSize === "string" ? parseInt(pageSize, 10) : pageSize;

  return {
    page: Math.max(0, parsedPage || 0),
    pageSize: Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parsedPageSize || DEFAULT_PAGE_SIZE)
    ),
  };
}
