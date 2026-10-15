type OrderOptions = { ascending: boolean; nullsFirst?: boolean }
// Structural stand-in for the PostgREST filter builder; typing against the
// real generic builder makes TypeScript's instantiation depth explode.
type Orderable = { order(column: string, options: OrderOptions): Orderable }

const relationSortPattern = /^([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*)\)$/

// PostgREST's `foreignTable` option only orders the embedded rows. Ordering the
// parent rows by a many-to-one relation requires the `relation(column)` form,
// which supabase-js forwards verbatim as `order=relation(column).desc`.
export function orderByRelation<T>(builder: T, relation: string, column: string, ascending: boolean): T {
  let ordered = (builder as Orderable).order(`${relation}(${column})`, { ascending })
  // Lessons on the same date are distinguished by their start time; prefer
  // the rescheduled time when one exists.
  if (relation === 'class_occurrences' && column === 'occurrence_date') {
    ordered = ordered
      .order('class_occurrences(actual_start_time)', { ascending, nullsFirst: false })
      .order('class_occurrences(original_start_time)', { ascending, nullsFirst: false })
  }
  return ordered as T
}

export function applyListOrder<T>(builder: T, sortName: string, ascending: boolean): T {
  const relationSort = relationSortPattern.exec(sortName)
  return relationSort
    ? orderByRelation(builder, relationSort[1], relationSort[2], ascending)
    : (builder as Orderable).order(sortName, { ascending }) as T
}
