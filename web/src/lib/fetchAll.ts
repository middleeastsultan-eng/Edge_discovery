// PostgREST (what Supabase's API runs on) silently caps every unbounded .select() at
// 1000 rows -- no error, no warning, just a truncated result (confirmed directly: a
// 69,625-row table returned exactly 1000 rows with status 206). Any page that needs a
// COMPLETE dataset -- a total count, an aggregate stat, "every trade for this pattern"
// -- must route through this helper instead of calling .select() directly, or it will
// silently go wrong the moment the real row count crosses 1000, with no error to catch
// it. Pages a capped "latest N" is fine for (a recent-activity feed) can keep using
// .limit() directly, as long as they label it honestly as recent/latest, not a total.
const PAGE_SIZE = 1000;

// The query passed in MUST include a stable, unique .order() (e.g. by id, or a
// timestamp column that's unique per row) -- .range() pagination over an unordered
// query has no guaranteed row order between pages and can silently skip or duplicate
// rows as the underlying table changes between page fetches.
export async function fetchAllRows<T>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}
