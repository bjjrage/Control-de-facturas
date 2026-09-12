// Identidad de un elemento BIM — dos claves con alcances distintos, no
// intercambiables:
//
//   express_id   STEP expressID (número de línea de la entidad en el
//                archivo IFC). Determinista para UN archivo concreto, pero
//                NO estable entre versiones/re-exportaciones: un nuevo
//                export del mismo modelo puede reordenar líneas y asignarle
//                otro número al "mismo" muro. Su único uso legítimo es
//                selección/render dentro de la sesión del viewer, siempre
//                acotado a un bim_model_id concreto (una fila = un archivo
//                subido). Nunca debe usarse solo, sin bim_model_id, como
//                clave de búsqueda o de identidad persistente.
//
//   ifc_guid     IfcGloballyUniqueId (GlobalId). Es la identidad que la
//                herramienta BIM le asigna al elemento y la que sobrevive a
//                re-exportar el mismo modelo. La unicidad en bim_elements es
//                (bim_model_id, ifc_guid) — ver 0070_bim_presupuesto.sql —
//                así que hoy identifica un elemento dentro de UNA versión
//                subida; es la clave a usar si en el futuro se quiere
//                reconciliar/heredar matches entre versiones del mismo
//                modelo (no implementado en este batch).
//
// Esta función es el único punto por el que el viewer (que solo conoce
// express_id, porque es lo que expone la geometría de web-ifc) resuelve el
// bim_element persistido — evita que un lookup ad hoc en un componente
// termine buscando por express_id sin acotar por modelo.
import type { BimElement } from "@/lib/types";

export function findElementByExpressId(
  elements: BimElement[],
  bimModelId: string,
  expressId: number
): BimElement | null {
  return elements.find((e) => e.bim_model_id === bimModelId && e.express_id === expressId) ?? null;
}
