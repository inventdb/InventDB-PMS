"""Registry of Property-Management entities stored in InventDB.

These map 1:1 to the types that already exist in the InventDB ``pms`` namespace,
so the app reads and writes the live data directly. Because InventDB is
schemaless, this registry is the app's authoritative list of "tables" (types)
and drives the generic CRUD router.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Entity:
    #: Type name inside the InventDB namespace (also the REST path segment).
    name: str
    #: Human-readable singular label.
    label: str
    #: Human-readable plural label.
    label_plural: str
    #: Business key field used for cross-entity references (not the _id).
    key: str
    #: Fields searched by the list endpoint's free-text ``q`` parameter.
    search_fields: list[str] = field(default_factory=list)
    #: Default column to sort lists by.
    order_by: str | None = None


# Order here is also the order surfaced by /api/meta/entities.
ENTITIES: list[Entity] = [
    Entity(
        name="properties",
        label="Property",
        label_plural="Properties",
        key="property_id",
        search_fields=["street", "city", "state", "zip", "region", "type", "status"],
        order_by="street",
    ),
    Entity(
        name="owners",
        label="Owner",
        label_plural="Owners",
        key="owner_id",
        search_fields=["name", "contact", "email", "phone", "type"],
        order_by="name",
    ),
    Entity(
        name="tenants",
        label="Tenant",
        label_plural="Tenants",
        key="tenant_id",
        search_fields=["first", "last", "email", "phone", "property_id"],
        order_by="last",
    ),
    Entity(
        name="leases",
        label="Lease",
        label_plural="Leases",
        key="lease_id",
        search_fields=["tenant_name", "property_id", "status", "renewal_type"],
        order_by="lease_start",
    ),
    Entity(
        name="work_orders",
        label="Work Order",
        label_plural="Work Orders",
        key="wo",
        search_fields=["wo", "issue", "category", "status", "priority", "property_id", "vendor"],
        order_by="date_opened",
    ),
    Entity(
        name="vendors",
        label="Vendor",
        label_plural="Vendors",
        key="vendor_id",
        search_fields=["company", "trade", "contact", "email", "phone"],
        order_by="company",
    ),
    Entity(
        name="transactions",
        label="Transaction",
        label_plural="Accounting",
        key="reference",
        search_fields=["type", "account_category", "party_tenant_vendor", "memo", "reference", "property_id"],
        order_by="date",
    ),
    Entity(
        name="inspections",
        label="Inspection",
        label_plural="Inspections",
        key="inspection_id",
        search_fields=["property_id", "type", "inspector", "status"],
        order_by="scheduled",
    ),
    Entity(
        name="compliance",
        label="Compliance Record",
        label_plural="Compliance",
        key="policy",
        search_fields=["property_id", "insurance_carrier", "policy", "status"],
        order_by="policy_expiry",
    ),
    Entity(
        name="daily_tasks",
        label="Daily Task",
        label_plural="Daily Tasks",
        key="task",
        search_fields=["task", "category", "status", "property_id"],
        order_by="date",
    ),
]

ENTITY_BY_NAME: dict[str, Entity] = {e.name: e for e in ENTITIES}


def get_entity(name: str) -> Entity | None:
    return ENTITY_BY_NAME.get(name)
