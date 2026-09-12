// Identidad de un elemento BIM — dos claves con alcances distintos, no
// intercambiables:
//
//   express_id   STEP expressID (número de línea de la entidad en el
//                archivo IFC). Identidad técnica EFÍMERA: solo tiene sentido
//                dentro de una instancia cargada de UN archivo IFC concreto
//                (un bim_model). Un nuevo export del mismo modelo puede
//                reordenar líneas y asignarle otro número al "mismo" muro.
//                Su único uso legítimo es selección/render dentro de la
//                sesión del viewer, siempre acotado a un bim_model_id
//                concreto (una fila = un archivo subido). Nunca debe usarse
//                solo, sin bim_model_id, como clave de búsqueda.
//
//   ifc_guid     IfcGloballyUniqueId (GlobalId). Es la identidad CANÓNICA del
//                elemento DENTRO DE UN bim_model concreto — la unicidad en
//                bim_elements es (bim_model_id, ifc_guid), ver
//                0070_bim_presupuesto.sql. La clave persistente hoy sigue
//                siendo, conceptualmente, `bim_model_id + ifc_guid`: no hay
//                identidad de elemento independiente del archivo subido.
//
//                ENTRE VERSIONES/RE-EXPORTACIONES (dos bim_model distintos
//                del "mismo" modelo real): la mayoría de las herramientas
//                BIM (Revit, ARCHICAD) preservan el GlobalId de un elemento
//                mientras no se borre y se recree en el software de origen,
//                pero esto NO es una garantía universal del estándar IFC —
//                puede cambiar por una operación de "purgar"/limpiar el
//                archivo, un roundtrip por otra herramienta, o el propio
//                comportamiento del exportador. GlobalId es una señal fuerte
//                para reconciliar versiones, no una prueba.
//
// Reconciliación entre versiones (IFC v1 -> IFC v2) NO está implementada en
// este batch. Si se construye a futuro, debe tratar el GlobalId como señal
// PRIMARIA (probablemente suficiente en la mayoría de los casos reales) pero
// diseñar para el caso en que falle, complementando con: IFC type, spatial
// path/storey, property sets, ubicación (placement) y, en última instancia,
// un fingerprint geométrico. Fuera de alcance acá — no ampliar scope.
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
