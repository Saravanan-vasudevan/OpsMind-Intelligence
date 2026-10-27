namespace OpsMind.Api.Contracts;

public record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public static class Paging
{
    public static (int Page, int PageSize) Normalise(int? page, int? pageSize, int maxPageSize = 200) =>
        (Math.Max(page ?? 1, 1), Math.Clamp(pageSize ?? 25, 1, maxPageSize));
}
