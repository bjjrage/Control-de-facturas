import { createAdminClient } from "@/lib/supabase/admin";
import { displayLocationName } from "@/lib/inventory/display-location-name";
import { hashWarehousePortalToken } from "@/lib/inventory/portal";

export type WarehousePortalOrderItem = {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  unit: string;
  ordered: number;
  received: number;
  pending: number;
};

export type WarehousePortalOrder = {
  id: string;
  code: string;
  providerName: string;
  status: string;
  authorizedAt: string | null;
  items: WarehousePortalOrderItem[];
};

export type WarehousePortalStockItem = {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
};

export type WarehousePortalBudgetItem = {
  id: string;
  code: string;
  description: string;
  unit: string;
};

export type WarehousePortalContext = {
  token: string;
  locationId: string;
  locationName: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  empresaId: string;
  orders: WarehousePortalOrder[];
  stock: WarehousePortalStockItem[];
  allProducts: Array<{ id: string; name: string; unit: string }>;
  budgetItems: WarehousePortalBudgetItem[];
};

export async function getWarehousePortalContext(token: string): Promise<WarehousePortalContext | null> {
  const admin = createAdminClient();
  const tokenHash = hashWarehousePortalToken(token);

  const { data: link, error: linkError } = await admin
    .from("warehouse_portal_links")
    .select("id, empresa_id, location_id, active, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (linkError || !link || !link.active) return null;
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return null;

  const { data: location, error: locError } = await admin
    .from("inventory_locations")
    .select("id, name, project_id, location_type, active")
    .eq("id", link.location_id)
    .eq("empresa_id", link.empresa_id)
    .maybeSingle();

  if (locError || !location || !location.active || location.location_type !== "PROJECT" || !location.project_id) {
    return null;
  }

  const { data: project, error: projError } = await admin
    .from("projects")
    .select("id, name, code")
    .eq("id", location.project_id)
    .eq("empresa_id", link.empresa_id)
    .maybeSingle();

  if (projError || !project) return null;

  // 1. Fetch authorized orders for this project
  const { data: ordersData } = await admin
    .from("authorized_orders")
    .select(`
      id,
      code,
      provider_id,
      status,
      authorized_at,
      providers (name),
      authorized_order_items (
        id,
        producto_id,
        description,
        unit,
        quantity,
        productos (nombre)
      )
    `)
    .eq("project_id", project.id)
    .eq("empresa_id", link.empresa_id)
    .in("status", ["AUTORIZADA", "RECIBIDA_PARCIAL", "EMITIDA"])
    .order("authorized_at", { ascending: false });

  const orderIds = (ordersData ?? []).map((o) => o.id);

  // 2. Fetch received quantities per order item
  let receivedByOrderItem = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: receiptItems } = await admin
      .from("oc_recepcion_items")
      .select(`
        order_item_id,
        cantidad_recibida,
        oc_recepciones!inner (status)
      `)
      .eq("empresa_id", link.empresa_id)
      .in("oc_recepciones.status", ["DRAFT", "CONFIRMED"]);

    for (const ri of receiptItems ?? []) {
      const current = receivedByOrderItem.get(ri.order_item_id) ?? 0;
      receivedByOrderItem.set(ri.order_item_id, current + Number(ri.cantidad_recibida || 0));
    }
  }

  const orders: WarehousePortalOrder[] = (ordersData ?? [])
    .map((order) => {
      const providerRaw = Array.isArray(order.providers) ? order.providers[0] : order.providers;
      const providerName = providerRaw?.name ?? "Proveedor";
      const itemsList = Array.isArray(order.authorized_order_items) ? order.authorized_order_items : [];

      const mappedItems: WarehousePortalOrderItem[] = itemsList.map((item) => {
        const productRaw = Array.isArray(item.productos) ? item.productos[0] : item.productos;
        const productName = productRaw?.nombre ?? item.description ?? "Material";
        const ordered = Number(item.quantity || 0);
        const received = receivedByOrderItem.get(item.id) ?? 0;
        const pending = Math.max(0, ordered - received);
        return {
          id: item.id,
          orderId: order.id,
          productId: item.producto_id ?? null,
          productName,
          unit: item.unit ?? "u",
          ordered,
          received,
          pending,
        };
      });

      return {
        id: order.id,
        code: order.code,
        providerName,
        status: order.status,
        authorizedAt: order.authorized_at,
        items: mappedItems,
      };
    })
    .filter((order) => order.items.some((item) => item.pending > 0));

  // 3. Fetch available stock in this warehouse location
  const { data: balancesData } = await admin
    .from("inventory_stock_by_location")
    .select("producto_id, producto, unidad, quantity")
    .eq("location_id", location.id)
    .eq("empresa_id", link.empresa_id);

  const stock: WarehousePortalStockItem[] = (balancesData ?? []).map((b) => ({
    productId: b.producto_id,
    productName: b.producto,
    unit: b.unidad,
    quantity: Number(b.quantity || 0),
  }));

  // 4. Fetch all active products for the company
  const { data: allProductsData } = await admin
    .from("productos")
    .select("id, nombre, unidad")
    .eq("empresa_id", link.empresa_id)
    .eq("activo", true)
    .order("nombre")
    .limit(1000);

  const allProducts = (allProductsData ?? []).map((p) => ({
    id: p.id,
    name: p.nombre,
    unit: p.unidad,
  }));

  // 5. Fetch budget items for this project
  const { data: budgetData } = await admin
    .from("budget_items")
    .select("id, code, description, unit")
    .eq("project_id", project.id)
    .eq("empresa_id", link.empresa_id)
    .order("sort_order");

  const budgetItems: WarehousePortalBudgetItem[] = (budgetData ?? []).map((bi) => ({
    id: bi.id,
    code: bi.code,
    description: bi.description,
    unit: bi.unit ?? "",
  }));

  return {
    token,
    locationId: location.id,
    locationName: displayLocationName(location.name),
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    empresaId: link.empresa_id,
    orders,
    stock,
    allProducts,
    budgetItems,
  };
}
