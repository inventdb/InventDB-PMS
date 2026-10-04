/**
 * How the ten PMS modules point at each other — the graph the drill-down panel
 * walks.
 *
 * It is derived from the field config rather than written out a second time:
 * every `ref` field already says "this column holds the business key of a record
 * in that module" (a lease's `property_id` is a property's `property_id`). The
 * panel uses an edge in both directions — as a link UP from the record that
 * holds it (this lease's property) and as a grid DOWN from the record it points
 * at (this property's leases).
 *
 * A few links in the data are by name rather than by key — a work order names
 * its vendor by company. Those are listed explicitly below so the vendor panel
 * can still show the work orders it was given.
 */
import { ENTITIES, ENTITY_BY_NAME, type EntityConfig } from "../config/entities";

export interface Relation {
  /** Module holding the pointer (the child). */
  from: string;
  /** Column on `from` that holds the pointer. */
  field: string;
  /** Module pointed at (the parent). */
  to: string;
  /** Column on `to` the pointer matches — the parent's business key by default. */
  toField: string;
  /** Label for the field on the child, e.g. "Property". */
  label: string;
}

/** Links that match on a name rather than a key. */
const SOFT_RELATIONS: Relation[] = [
  { from: "work_orders", field: "vendor", to: "vendors", toField: "company", label: "Vendor" },
];

export const RELATIONS: Relation[] = [
  ...ENTITIES.flatMap((cfg) =>
    cfg.fields
      .filter((f) => f.ref && ENTITY_BY_NAME[f.ref])
      .map<Relation>((f) => ({
        from: cfg.name,
        field: f.name,
        to: f.ref as string,
        toField: ENTITY_BY_NAME[f.ref as string].key,
        label: f.label,
      }))
  ),
  ...SOFT_RELATIONS,
];

/** Links up from a record of `entity`: the records it points at. */
export function parentsOf(entity: string): Relation[] {
  return RELATIONS.filter((r) => r.from === entity);
}

/**
 * Grids down from a record of `entity`: every module that points at it, in the
 * order the modules appear in the sidebar so the panel reads predictably.
 */
export function childrenOf(entity: string): Relation[] {
  const order = ENTITIES.map((e) => e.name);
  return RELATIONS.filter((r) => r.to === entity).sort(
    (a, b) => order.indexOf(a.from) - order.indexOf(b.from)
  );
}

/** The relation behind a field on a record, if the field is a pointer. */
export function relationFor(entity: string, field: string): Relation | undefined {
  return RELATIONS.find((r) => r.from === entity && r.field === field);
}

/** Section heading for a child grid: "Leases", or "Work Orders (follow-up)". */
export function childHeading(rel: Relation, cfg: EntityConfig | undefined): string {
  const plural = cfg?.labelPlural ?? rel.from;
  const siblings = RELATIONS.filter((r) => r.to === rel.to && r.from === rel.from);
  return siblings.length > 1 ? `${plural} · by ${rel.label.toLowerCase()}` : plural;
}
