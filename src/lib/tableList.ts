// What the admin tables read: a page size the server is asked for, and the
// status its filter offers.
export const TABLE_PAGE_SIZE = 20;

// The status every list offers: clients and clinics both carry an active flag.
export type StatusFilter = "all" | "active" | "inactive";

// What the list queries take. A list that offers every status sends nothing, so
// the filter stays off the query.
export function statusFilterArg(filter: StatusFilter): "active" | "inactive" | undefined {
  return filter === "all" ? undefined : filter;
}
