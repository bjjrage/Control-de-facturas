export type PracticeField = { label: string; sample: string; type?: "text" | "number"; options?: readonly string[] };
export type PracticeStep = { title: string; instruction: string; action: string; result: string; fields: PracticeField[] };
export type PracticeGuide = {
  id: string; title: string; module: string; path: string; href: string;
  description: string; requirements: string; roles: string[]; plan: string;
  notes: string[]; sources: string[]; steps: PracticeStep[];
};
const field = (label: string, sample: string, type?: "text" | "number"): PracticeField => ({label,sample,type});
const choice = (label: string, sample: string, options: string[]): PracticeField => ({label,sample,options});
const step = (title: string, instruction: string, action: string, result: string, fields: PracticeField[] = []): PracticeStep => ({title,instruction,action,result,fields});
const project = "app/(internal)/projects/[id]/";
const purchasing = "app/(internal)/rfqs/[id]/";
const adminRoles = ["Administración", "Admin"];
function guide(id: string, title: string, module: string, path: string, description: string, requirements: string, sources: string[], steps: PracticeStep[], notes: string[] = [], href = "/projects", plan = "Pro", roles = adminRoles): PracticeGuide {
  return {id,title,module,path,description,requirements,sources,steps,notes,href,plan,roles};
}

/** Teaching content reviewed against main 842ac721; examples never execute business actions. */
export const GUIDES: PracticeGuide[] = [
  guide("activar","Ubicarte y revisar accesos","Empezar","Administración · Operativo · Licitaciones","Elegí el espacio correcto y reconocé qué habilita tu cuenta.","Una cuenta activa. El administrador configura plan y módulos.",["components/layout/topbar.tsx","components/layout/sidebar.tsx","lib/projects/project-features.ts"],[
    step("Elegir el espacio","Para gestionar una obra, entrá a Operativo y elegí un proyecto.","Entrar a Operativo","La obra agrupa Preparar, Comprar, Avance de obra y Certificar.",[choice("Espacio","Operativo",["Administración","Operativo","Licitaciones"])]),
    step("Reconocer el acceso","En la app real, Pro habilita proyectos e inventario; Caterpillar agrega BIM, personal y certificados.","Revisar acceso","Un plan habilitado no sustituye el rol ni los módulos de la empresa.",[choice("Plan del ejemplo","Pro",["Básico","Pro","Caterpillar"])]),
    step("Volver a la ayuda","El instructivo guarda tu avance de aprendizaje en este navegador.","Abrir práctica","Podés aprender con datos de ejemplo antes de operar en la app real.")
  ],["Esta práctica no cambia el plan de la empresa.","Planes y configuración real: controles del administrador en la barra derecha."],"/dashboard","Todos",["Comercial",...adminRoles]),
  guide("crear-proyecto","Crear una obra","Empezar","Operativo → Nuevo proyecto","Prepará la obra que reúne presupuesto, abastecimiento y avance.","Rol Administración o Admin y plan Pro o superior.",["app/(internal)/projects/actions.ts","app/(internal)/projects/page.tsx"],[
    step("Identificar la obra","Usá estos datos ficticios para reconocer la ficha del proyecto.","Completar ficha","La obra del ejercicio queda identificada; todavía no existe en tu empresa.",[field("Código","OBR-DEMO"),field("Nombre","Vivienda de práctica")]),
    step("Organizar el depósito","Elegí crear el depósito vinculado cuando la obra va a manejar materiales físicos.","Crear proyecto de ejemplo","En la app real la opción crea el pañol asociado al proyecto.",[choice("Depósito de obra","Crear depósito",["Crear depósito","Sin depósito"])]),
    step("Entrar al proyecto","Ubicá las herramientas en sus cuatro grupos del menú.","Abrir la obra","Preparar → Comprar → Avance de obra → Certificar. Crear una OT comercial es un circuito diferente.")
  ]),
  guide("presupuesto","Cargar el presupuesto","Preparar","Obra → Preparar → Presupuesto","Cargá partidas con unidad, cantidad y precio; revisá el resultado antes de guardar.","Proyecto creado y cómputo disponible.",[project+"import-budget-dialog.tsx",project+"presupuesto-table.tsx","app/(internal)/projects/actions.ts"],[
    step("Preparar una partida","Identificá código, descripción y unidad del cómputo.","Preparar fila","La partida del ejemplo es 1.1 · Hormigón · m³.",[field("Código de partida","1.1"),field("Descripción","Hormigón")]),
    step("Mapear cantidades y precios","Al importar, revisá el mapeo de columnas y los errores de la vista previa.","Revisar presupuesto","10 m³ × 500.000 PYG = 5.000.000 PYG de venta contractual; no es el costo de materiales.",[field("Cantidad","10","number"),field("Precio unitario PYG","500000","number")]),
    step("Confirmar los datos válidos","Corregí las filas señaladas y verificá jerarquía, unidades y totales.","Importar ejemplo","El presupuesto queda preparado para programar y costear. La importación real requiere confirmación.")
  ]),
  guide("planilla-embebida","Editar la planilla de trabajo","Preparar","Obra → Presupuesto → Generar plantilla de trabajo","Diferenciá el borrador de la aplicación al presupuesto.","Partidas cargadas; acceso a Presupuesto.",[project+"generar-planilla-button.tsx","app/(internal)/planillas/[id]/page.tsx"],[
    step("Abrir la planilla","Generá una plantilla de trabajo desde Presupuesto.","Generar ejemplo","La grilla contiene una copia de trabajo del presupuesto."),
    step("Editar el borrador","Modificá una cantidad; el subtotal se recalcula en la grilla.","Guardar borrador de ejemplo","El autosave guarda la sesión de trabajo, no confirma todavía el presupuesto.",[field("Nueva cantidad","12","number")]),
    step("Confirmar la planilla","Revisá altas, modificaciones y bajas antes de confirmar.","Confirmar ejemplo","La confirmación real aplica el conjunto y rechaza conflictos con cambios de otra persona.")
  ]),
  guide("costeo","Completar el costeo y las APU","Preparar","Obra → Preparar → Costeo","Distinguí precio de venta, receta de materiales y costo disponible.","Presupuesto con cantidades; materiales y mano de obra configurados.",[project+"costeo-section.tsx",project+"costeo-checklist.tsx",project+"apu-dialog.tsx"],[
    step("Revisar pendientes","Seguí el checklist: partidas, recetas APU, mano de obra, materiales y costo final.","Revisar partida","Una partida sin receta o sin precio requiere revisión; no se interpreta como costo cero."),
    step("Relacionar material y partida","La APU define cuánto material necesita una unidad ejecutada.","Configurar ejemplo","Por cada m³ del ejercicio se requieren 300 kg de cemento antes de merma.",[field("Material","Cemento"),field("kg por m³","300","number")]),
    step("Interpretar el resultado","Revisá costos completos y pendientes antes de confiar en el margen.","Revisar costeo","El total de venta y el costo son números diferentes. Cotizar costos tampoco emite una OC.")
  ]),
  guide("cronograma","Programar el cronograma","Preparar","Obra → Preparar → Cronograma / Gantt","Ubicá partidas en el tiempo sin inventar avance ejecutado.","Presupuesto con partidas ejecutables.",[project+"project-gantt.tsx",project+"programar-partidas-dialog.tsx"],[
    step("Elegir la partida","Programá una partida del cómputo.","Seleccionar partida","Se trabajará sobre 1.1 · Hormigón.",[field("Partida","1.1")]),
    step("Definir el período","Cargá inicio y fin; las fechas del ejemplo son ficticias.","Programar ejemplo","La barra representa la programación, no una certificación de trabajo hecho.",[field("Inicio","2026-11-02"),field("Fin","2026-11-06")]),
    step("Distinguir fecha y avance","Mover fechas no equivale a registrar cantidades ejecutadas.","Revisar Gantt","El avance se registra en Registro de avance; el cronograma explica lo previsto.")
  ]),
  guide("plan-semanal","Planificar la semana y sus materiales","Preparar","Obra → Preparar → Plan semanal","Traducí una meta a materiales, faltantes y caja; después decidí comprometer.","Presupuesto, receta/BOM y stock configurados según la actividad.",[project+"weekly-plan-section.tsx","lib/procurement/weekly-plan-engine.ts","app/(internal)/projects/weekly-plan-actions.ts"],[
    step("Definir la intención","Elegí período y meta física; podés usar receta o partidas por bloque/frente.","Definir meta","La intención es ejecutar 120 m². Clima OFF permite calcular sin pronóstico.",[field("Meta m²","120","number")]),
    step("Calcular el faltante","Ejemplo: demanda 6.300, stock de obra 1.800, central disponible 0 e inbound a tiempo 2.500.","CALCULAR PLAN","Faltan 2.000 unidades. A 2.400 PYG, la caja adicional es 4.800.000 PYG. El preview no reserva stock.",[field("Faltante","2000","number"),field("Caja adicional PYG","4800000","number")]),
    step("Elegir cómo guardar","Borrador y comprometido tienen efectos distintos en la app real.","Comprometer ejemplo","El servidor real recalcula y compara antes de reservar central de forma atómica. Si cambió el abastecimiento, pide recalcular.",[choice("Acción","Comprometer plan",["Guardar borrador","Comprometer plan"])])
  ],["La ubicación canónica es Preparar → Plan semanal, separada de Avance físico.","El clima evalúa factibilidad; no recorta la meta ni la compra base."]),
  guide("bim","Vincular el modelo BIM","Preparar","Obra → Preparar → BIM / IFC","Revisá el modelo y la asociación con partidas antes de adoptar cantidades.","Plan Caterpillar, archivo IFC y presupuesto de la obra.",[project+"bim-section.tsx",project+"bim-actions.ts"],[
    step("Preparar el modelo","Seleccioná un IFC de ejemplo para ubicar su uso en el proyecto.","Abrir ejemplo IFC","Esta representación no carga ni procesa un archivo real.",[field("Archivo de ejemplo","vivienda-demo.ifc")]),
    step("Revisar la asociación","El elemento debe relacionarse con la partida y unidad correctas.","Revisar vínculo","La vinculación del ejercicio apunta a 1.1 · Hormigón.",[field("Partida destino","1.1")]),
    step("Adoptar con revisión","Compará la medición con el presupuesto antes de aplicarla.","Confirmar ejemplo","Ver un elemento o una sugerencia no modifica por sí solo el cómputo.")
  ],[],"/projects","Caterpillar"),
  guide("proveedores","Preparar proveedores","Comprar","Obra → Comprar → Proveedores / Administración → Comprar → Proveedores","Diferenciá catálogo de empresa y proveedores vinculados a una obra.","Admin para el catálogo global; acceso de obra para su vinculación.",["components/layout/sidebar.tsx",project+"proyecto-proveedores-table.tsx"],[
    step("Identificar proveedor","Revisá nombre y RUC antes de reutilizar un contacto.","Revisar proveedor","Se utilizará Proveedor Demo, con datos ficticios.",[field("Nombre","Proveedor Demo")]),
    step("Vincular a la obra","Elegí el proveedor apropiado para la obra.","Vincular ejemplo","El vínculo organiza la compra de esta obra; no adjudica una cotización."),
    step("Preparar la solicitud","Revisá contacto, materiales y condiciones antes de invitar.","Preparar cotización","La solicitud podrá usar proveedores del catálogo.")
  ]),
  guide("rfqs","Comparar y adjudicar una compra","Comprar","Obra → Comprar → Cotizaciones","Separá revisión, selección, autorización y emisión de la OC.","Solicitud y ofertas disponibles. El circuito de costos termina en adoptar precios.",[purchasing+"purchasing-offers.tsx",purchasing+"rfq-workspace.tsx"],[
    step("Revisar las ofertas","Comprobá cantidad, unidad, precio, entrega y diferencias del documento original.","Registrar revisión","La revisión humana permite seguir a la adjudicación.",[field("Material","Cemento"),field("Cantidad","100","number")]),
    step("Elegir y justificar","Seleccioná proveedor y justificá la decisión antes de autorizar.","Guardar adjudicación","Guardar la selección todavía no emite una orden de compra.",[field("Justificación","Mejor precio y entrega dentro del plazo")]),
    step("Autorizar y emitir","Revisá la vista previa y confirmá la emisión.","Emitir OC de ejemplo","Solo la confirmación de emisión crea la OC en el circuito de compra real.")
  ],["Una cotización de descubrimiento de costos no adjudica ni emite OC."],"/rfqs","Básico / obra Pro",["Comercial",...adminRoles]),
  guide("ordenes-compra","Revisar una orden de compra","Comprar","Obra → Comprar → OC","Controlá la obligación de compra y su saldo, separada de factura y recepción.","OC emitida o compra manual autorizada.",[project+"proyecto-compras-table.tsx","lib/reconciliation.ts"],[
    step("Identificar la OC","Verificá proveedor, obra y monto de la orden.","Revisar orden","La OC del ejemplo pertenece a OBR-DEMO.",[field("Código OC","OC-DEMO-001")]),
    step("Leer el saldo","Una OC puede recibir y facturar parcialmente.","Revisar saldo","OC 1.000.000 − facturado 400.000 = saldo por facturar 600.000 PYG.",[field("Saldo por facturar PYG","600000","number")]),
    step("Separar los estados","Recibido, facturado y pagado describen hechos diferentes.","Continuar a recepción","Registrar una factura no demuestra que llegó el material.")
  ],[],"/orders","Básico / obra Pro",["Comercial",...adminRoles]),
  guide("recepciones","Recibir materiales con evidencia","Comprar","Obra → Comprar → Recepciones","Registrá cantidades recibidas y respaldo en el depósito correcto.","OC o recepción disponible y depósito de destino identificado.",[project+"project-receipts-section.tsx",project+"project-receipts-list.tsx","lib/inventory/service.ts"],[
    step("Elegir destino","Elegí la OC y el depósito donde llegó el material.","Preparar recepción","Destino del ejercicio: Pañol OBR-DEMO.",[field("Depósito","Pañol OBR-DEMO")]),
    step("Medir lo recibido","La recepción puede ser parcial: cargá la cantidad que llegó, no toda la OC por defecto.","Registrar cantidad de ejemplo","Se registran 40 bolsas recibidas.",[field("Bolsas recibidas","40","number")]),
    step("Completar el respaldo","Revisá remito y evidencias, y resolvé los pendientes que informe la recepción.","Confirmar ejemplo","La recepción real controla su evidencia y estado antes de considerarse completa.")
  ]),
  guide("basico-facturas","Cargar y revisar una factura de compra","Comprar","Administración → Comprar → Facturas / Obra → Comprar → Facturas","Revisá la lectura del documento y su vinculación con una OC del mismo proveedor.","Administración o Admin, módulo Compras y documento legible.",["app/(internal)/invoices/actions.ts","app/(internal)/invoices/bulk/page.tsx","lib/reconciliation.ts"],[
    step("Preparar el documento","Podés cargar archivo o usar Control Scanner. El límite actual es 20 MiB.","Leer factura de ejemplo","La extracción es una propuesta para revisar, no la confirmación de los datos.",[choice("Documento","PDF de 20 MiB",["PDF de 20 MiB","PDF de 21 MiB"])]),
    step("Revisar identidad e importes","Comprobá proveedor/RUC, número, fecha y total, además de duplicados.","Revisar extracción","La factura del ejercicio tiene un total de 400.000 PYG.",[field("Total PYG","400000","number")]),
    step("Conciliar con la compra","Revisá la OC del mismo proveedor y las diferencias del acumulado facturado.","Vincular ejemplo","MATCH o una excepción aprobada permite continuar la revisión de aptitud; no significa pagada.")
  ],["El pago exige las validaciones del servidor, incluida la recepción cuando corresponde; no alcanza con una lectura IA."],"/invoices","Básico"),
  guide("basico-pagos","Preparar y ejecutar un pago","Comprar","Administración → Comprar → Pagos / Obra → Comprar → Pagos","Agrupá facturas aptas del mismo proveedor y registrá el pago.","Facturas habilitadas para pago y fondos/medio de pago revisados.",["app/(internal)/pagos/actions.ts","app/(internal)/pagos/nueva/page.tsx"],[
    step("Elegir facturas aptas","Seleccioná el proveedor; comprobá aptitud y saldos antes de agrupar.","Seleccionar ejemplo","Se eligen facturas del mismo proveedor.",[field("Proveedor","Proveedor Demo")]),
    step("Revisar la OP","Verificá total, facturas y respaldo de la orden de pago.","Crear OP de ejemplo","Crear la OP todavía no demuestra que se ejecutó una transferencia.",[field("Total PYG","400000","number")]),
    step("Registrar la ejecución","Registrá la ejecución solo cuando el pago realmente se realizó.","Ejecutar ejemplo","La operación real actualiza los documentos según las reglas de pago y conserva su respaldo.")
  ],[],"/pagos","Básico"),
  guide("ejecucion","Registrar avance de obra","Avance de obra","Obra → Avance de obra → Registro de avance","Cargá lo que efectivamente se ejecutó, separado del plan y del certificado.","Proyecto y partida; para portal externo, enlace/QR válido.",[project+"add-execution-entry-form.tsx",project+"execution-link-dialog.tsx","app/avance/[token]/actions.ts"],[
    step("Elegir partida y fecha","Ubicá la partida ejecutada en el día informado.","Preparar parte","Parte del ejercicio: 1.1 · Hormigón.",[field("Partida","1.1")]),
    step("Registrar cantidad real","La meta prevista no se carga como ejecutada si todavía no se hizo.","Registrar ejemplo","Se agregan 2 m³ de avance real en la simulación.",[field("Cantidad ejecutada m³","2","number")]),
    step("Revisar la evidencia","Distinguí captura de cámara, ubicación disponible y archivo adjunto.","Guardar ejemplo","Las fotos respaldan el parte; una etiqueta de captura no certifica por sí sola la autenticidad física.")
  ]),
  guide("stock","Consultar y mover inventario","Avance de obra","Administración → Comprar → Stock e Inventario / Obra → Avance de obra → Inventario","Distinguí catálogo de materiales, saldo físico y movimientos.","Plan Pro o superior, módulo Compras y permisos de inventario.",["app/(internal)/inventario/page.tsx","lib/inventory/service.ts",project+"inventario-obra-section.tsx"],[
    step("Elegir producto y depósito","El catálogo de Materiales no reemplaza el saldo físico por ubicación.","Consultar inventario","Producto: Cemento; ubicación: Pañol OBR-DEMO.",[field("Producto","Cemento")]),
    step("Elegir el movimiento","Consumo, transferencia y ajuste tienen propósitos diferentes.","Preparar consumo","El ejercicio consume 10 bolsas del depósito de obra.",[choice("Movimiento","Consumo",["Consumo","Transferencia","Ajuste"]),field("Cantidad","10","number")]),
    step("Verificar el efecto","Revisá origen, destino cuando corresponda, imputación y disponibilidad.","Confirmar ejemplo","La operación real valida saldo y permisos. Transferir material no es consumirlo.")
  ]),
  guide("panol","Consultar el depósito de obra","Avance de obra","Obra → Avance de obra → Depósito de obra","Ubicá el depósito físico asociado al proyecto y su abastecimiento.","Proyecto con pañol vinculado.",[project+"panol-obra-section.tsx",project+"proyecto-stock-section.tsx"],[
    step("Ubicar el pañol","Consultá qué depósito pertenece a esta obra.","Abrir pañol de ejemplo","Se utiliza Pañol OBR-DEMO.",[field("Depósito","Pañol OBR-DEMO")]),
    step("Revisar disponibilidad","El stock de otra obra no está disponible automáticamente para esta.","Consultar saldo","Una necesidad puede cubrirse desde central disponible mediante el circuito correspondiente."),
    step("Preparar la transferencia","Si el material cambia de depósito, usá una transferencia y revisá ambos extremos.","Revisar transferencia de ejemplo","El traslado conserva la trazabilidad; no se inventa una recepción ni un consumo.")
  ]),
  guide("personal","Registrar mano de obra","Avance de obra","Obra → Avance de obra → Personal","Registrá trabajador, horas y tarifa para leer el costo de la obra.","Plan Caterpillar y permisos de proyecto.",[project+"personal-table.tsx",project+"add-labor-entry-form.tsx",project+"labor-payments-panel.tsx"],[
    step("Identificar el parte","Elegí trabajador y jornada.","Preparar parte laboral","Se usará Trabajador Demo.",[field("Trabajador","Trabajador Demo")]),
    step("Cargar horas y tarifa","Usá 8 horas a 35.000 PYG por hora.","Calcular ejemplo","El costo del parte es 280.000 PYG.",[field("Horas","8","number"),field("Tarifa por hora PYG","35000","number")]),
    step("Revisar costo y pago","Registrar trabajo y registrar su pago son acciones diferentes.","Guardar ejemplo","El parte alimenta el costo de mano de obra; revisá el circuito de pagos por separado.")
  ],[],"/projects","Caterpillar"),
  guide("subcontratistas","Crear un contrato de subcontrato","Avance de obra","Obra → Avance de obra → Subcontratistas","Relacioná contratista, partida, monto y retención.","Plan Caterpillar y presupuesto disponible.",[project+"subcontratistas-table.tsx",project+"add-subcontractor-contract-dialog.tsx"],[
    step("Identificar el contrato","Seleccioná subcontratista y partida.","Preparar contrato","El contrato del ejercicio corresponde a Instalaciones Demo.",[field("Subcontratista","Instalaciones Demo")]),
    step("Definir condiciones","Revisá monto y retención antes de crear.","Crear contrato de ejemplo","Se establece un monto contratado de 22.000.000 PYG.",[field("Monto contratado PYG","22000000","number")]),
    step("Revisar seguimiento","El contrato y sus certificados permiten controlar cuánto se aprobó.","Abrir certificados","Crear un contrato no equivale a aprobar un certificado ni pagarlo.")
  ],[],"/projects","Caterpillar"),
  guide("portal","Usar el portal del subcontratista","Avance de obra","Subcontratistas → contrato → Ver certificados","Reconocé el acceso externo y la presentación de un certificado.","Contrato activo y enlace válido proporcionado por la empresa.",[project+"subcontratistas-table.tsx","app/certificados/[token]/certificate-form.tsx"],[
    step("Preparar el enlace","Revisá contrato y destinatario antes de compartir el enlace real.","Abrir portal de ejemplo","El portal del ejercicio contiene únicamente datos ficticios."),
    step("Presentar el avance","El subcontratista informa el avance y su respaldo.","Presentar certificado de ejemplo","La presentación queda pendiente de revisión; no constituye aprobación.",[field("Avance informado %","25","number")]),
    step("Esperar la revisión","La empresa revisa lo presentado antes de reconocer el monto.","Consultar estado","Un contrato cerrado no debe usarse para presentar nuevos certificados.")
  ],[],"/projects","Caterpillar"),
  guide("cert-sub","Revisar un certificado de subcontrato","Avance de obra","Subcontratistas → contrato → Ver certificados → Revisar","Contrastá el reclamo con el contrato y su saldo.","Plan Caterpillar y certificado pendiente.",[project+"subcontratistas-table.tsx","lib/certificate-ai.ts"],[
    step("Leer el reclamo","Revisá trabajo, evidencia y observaciones; el análisis IA es apoyo.","Abrir revisión de ejemplo","La decisión final sigue siendo humana."),
    step("Comprobar el techo","Contrato de 22.000.000; ya aprobado 21.500.000.","Revisar monto","El saldo contractual del ejercicio es 500.000 PYG.",[field("Monto a aprobar PYG","500000","number")]),
    step("Decidir y registrar","No apruebes por encima del saldo disponible.","Aprobar ejemplo","Se reconoce el monto revisado. La aprobación del certificado no registra automáticamente su pago.")
  ],[],"/projects","Caterpillar"),
  guide("climate-workdays","Registrar una jornada climática","Avance de obra","Obra → Preparar → Cronograma / Gantt → Días climáticos","Separá pronóstico, observación y confirmación humana.","Coordenadas, regla contractual y evidencia de la jornada.",[project+"climate-workdays-panel.tsx",project+"climate-libro-calendar.tsx"],[
    step("Revisar la regla","Comprobá el umbral contractual y la fuente disponible.","Revisar jornada","Umbral de ejemplo: 15 mm; lectura de ejemplo: 22 mm.",[field("Umbral mm","15","number"),field("Lectura mm","22","number")]),
    step("Confirmar lo ocurrido","Revisá pluviómetro y condiciones reales antes de confirmar la propuesta.","Confirmar ejemplo","La observación humana y su evidencia se distinguen del dato externo."),
    step("Distinguir efectos posteriores","Un efecto de lluvia posterior debe referir a una jornada previa válida.","Revisar efecto de ejemplo","El clima histórico documenta hechos. El pronóstico semanal solo estima factibilidad.")
  ]),
  guide("cert-comitente","Preparar un certificado al comitente","Certificar","Obra → Certificar → Certificados","Revisá cantidades del período y avanzá por el circuito de estados.","Plan Caterpillar, contrato y partidas con cantidad/precio. El certificado anterior debe estar aprobado o facturado.",["app/(internal)/projects/certificado-actions.ts",project+"certificados-table.tsx",project+"paste-avance-dialog.tsx"],[
    step("Crear el período","La creación toma el anterior de certificados congelados y el presente de registros del período.","Crear borrador de ejemplo","Las cantidades pueden revisarse mientras está en BORRADOR."),
    step("Revisar las mediciones","Podés corregir, importar o pegar cantidades, siempre comprobando su correspondencia.","Revisar presente","Se certifican 2 m³ en el ejemplo.",[field("Cantidad presente m³","2","number")]),
    step("Elaborar y controlar estados","El circuito es BORRADOR → ELABORADO → VERIFICADO → APROBADO → FACTURADO.","Elaborar ejemplo","Desde ELABORADO el contenido queda congelado. Marcar FACTURADO no prueba un cobro ni una emisión fiscal externa.")
  ],[],"/projects","Caterpillar"),
  guide("avance-fisico","Interpretar el avance físico","Certificar","Obra → Certificar → Avance físico","Leé la curva acumulada y distinguí su fuente del parte diario.","Plan Caterpillar, programación y certificados congelados para la curva real.",[project+"avance-fisico-panel.tsx",project+"project-tabs-client.tsx"],[
    step("Separar las fuentes","El cronograma explica lo planificado; los certificados congelados explican el avance certificado.","Leer la curva","Un parte diario aún no certificado no equivale al punto de la curva certificada."),
    step("Leer una brecha","En este ejemplo se previó 40% y se certificó 30%.","Comparar avance","La brecha es de 10 puntos porcentuales; no son 10 unidades de material.",[field("Brecha en puntos","10","number")]),
    step("Volver al plan semanal","Para definir qué hacer la próxima semana, usá Preparar → Plan semanal.","Abrir planificación de ejemplo","La meta futura, el registro real y la certificación son tres lecturas distintas.")
  ],[],"/projects","Caterpillar"),
  guide("informes","Revisar los informes de obra","Certificar","Obra → Certificar → Informes","Contrastá presupuesto, ejecución y compras antes de exportar.","Proyecto con los datos que quieras analizar.",[project+"reports.tsx",project+"consumo-materiales-section.tsx"],[
    step("Revisar el contexto","Confirmá que estás mirando la obra y el período correctos.","Abrir informe de ejemplo","Los indicadores corresponden a OBR-DEMO.",[field("Obra","OBR-DEMO")]),
    step("Distinguir los indicadores","Presupuesto, compra, consumo, pago y cobro no significan lo mismo.","Interpretar informe","Una compra registrada no es automáticamente material consumido ni dinero pagado."),
    step("Exportar después de revisar","Usá los exportes disponibles para compartir la lectura verificada.","Preparar exporte de ejemplo","Exportar resume los registros; no crea certificados ni movimientos de caja.")
  ]),
  guide("clientes","Preparar un cliente","Vender y cobrar","Administración → Vender → Clientes","Revisá identidad y contacto antes de emitir documentos.","Módulo Ventas y rol Administración o Admin.",["app/(internal)/clientes/page.tsx","app/(internal)/clientes/actions.ts"],[
    step("Identificar al cliente","Consultá si ya existe antes de agregarlo.","Buscar cliente de ejemplo","Se utilizará Cliente Demo.",[field("Cliente","Cliente Demo")]),
    step("Revisar los datos","Contrastá RUC, contacto y condiciones aplicables.","Completar ejemplo","Los datos del ejercicio son ficticios y no se escriben al catálogo."),
    step("Elegir el documento","Definí si corresponde presupuesto, entrega o factura.","Continuar a ventas","Cliente cargado no significa que ya tenga una deuda.")
  ],[],"/clientes","Básico"),
  guide("proformas","Aceptar una proforma y generar la OT","Vender y cobrar","Administración → Vender → Proformas → Aceptación electrónica","Separá aceptación del cliente y aprobación interna de la orden de trabajo.","Cliente y proforma con versión/importes revisados, módulo Ventas.",["app/(internal)/ventas/[id]/page.tsx","app/(internal)/ordenes-trabajo/[id]/page.tsx","app/cotizacion/[token]/page.tsx"],[
    step("Preparar la propuesta","Revisá cliente, cantidades, total y versión antes de generar el enlace.","Preparar link de ejemplo","El enlace real corresponde a una versión concreta; copiarlo no significa enviado."),
    step("Aceptar como cliente","En el portal, abrir el enlace no acepta: hay una confirmación explícita.","Confirmar aceptación de ejemplo","La aceptación genera un registro y la OT interna correspondiente.",[field("Nombre del aceptante ficticio","Cliente Demo")]),
    step("Revisar la OT interna","El responsable revisa la aprobación para producción según su permiso.","Abrir OT de ejemplo","La OT no crea automáticamente una obra, una compra, una factura ni un movimiento de stock.")
  ],[],"/proformas","Básico"),
  guide("remisiones","Documentar una entrega","Vender y cobrar","Administración → Vender → Remisiones","Registrá una entrega sin confundirla con facturación o cobro.","Cliente, ítems y procedencia revisados.",["app/(internal)/remisiones/nueva/page.tsx","app/(internal)/ventas/actions.ts"],[
    step("Preparar la entrega","Revisá cliente y documento de origen cuando corresponda.","Preparar remisión","La remisión del ejercicio corresponde a Cliente Demo.",[field("Cliente","Cliente Demo")]),
    step("Revisar cantidades","Comprobá lo que realmente se entrega.","Revisar entrega","Se documentan 5 unidades.",[field("Cantidad","5","number")]),
    step("Emitir el documento adecuado","La remisión documenta entrega; para la cuenta por cobrar se usa la factura.","Emitir remisión de ejemplo","No se registra ningún cobro por emitir una remisión.")
  ],[],"/remisiones","Básico"),
  guide("facturas-venta","Emitir factura de venta y revisar NC","Vender y cobrar","Administración → Vender → Facturas / NC","Diferenciá borrador, emisión comercial y facturación electrónica configurada.","Cliente, módulo Ventas, importes y origen revisados.",["app/(internal)/ventas/actions.ts","app/(internal)/ventas/nueva-nc/page.tsx","supabase/migrations/20261018120700_guard_sales_emission_cap.sql"],[
    step("Preparar la factura","Revisá cliente, ítems, moneda y relación con los documentos de origen.","Crear borrador de ejemplo","Un borrador no demuestra que ya se emitió un documento fiscal.",[field("Total PYG","1000000","number")]),
    step("Revisar y emitir","Confirmá la emisión solo después de comprobar los importes y los límites del origen.","Emitir ejemplo","La factura emitida puede generar saldo por cobrar; emitir no equivale a cobrar."),
    step("Distinguir una corrección","Una NC puede iniciarse desde factura o desde el formulario disponible; revisá los límites que valide el servidor.","Revisar NC de ejemplo","La emisión electrónica requiere Goekua configurado y una respuesta válida del proveedor; la práctica no lo invoca.")
  ],[],"/facturas-venta","Básico"),
  guide("cobros","Registrar un cobro del cliente","Vender y cobrar","Administración → Vender → Cobros","Aplicá el dinero recibido contra la factura correspondiente.","Factura emitida con saldo y cobro efectivamente recibido.",["app/(internal)/cobros/page.tsx","app/(internal)/ventas/actions.ts"],[
    step("Elegir la factura","Comprobá cliente y saldo pendiente.","Seleccionar factura","Factura del ejemplo: 1.000.000 PYG pendiente.",[field("Cliente","Cliente Demo")]),
    step("Registrar el importe recibido","Un cobro parcial no salda automáticamente toda la factura.","Registrar cobro de ejemplo","Cobro 400.000; saldo restante 600.000 PYG.",[field("Cobrado PYG","400000","number")]),
    step("Revisar el saldo","Verificá método, fecha y saldo luego de guardar.","Consultar saldo","La cuenta por cobrar se reduce por el cobro registrado, no por descargar un PDF.")
  ],[],"/cobros","Básico"),
  guide("tesoreria","Leer tesorería y flujo de caja","Vender y cobrar","Administración → Finanzas → Tesorería / Flujo de caja","Separá saldos, proyecciones y caja adicional del plan semanal.","Administración o Admin; cuentas y documentos correctamente registrados.",["app/(internal)/tesoreria/page.tsx","app/(internal)/flujo-caja/page.tsx"],[
    step("Elegir la lectura","Identificá saldo disponible y obligaciones próximas.","Abrir tesorería de ejemplo","Un compromiso futuro no equivale a un egreso ya ejecutado."),
    step("Relacionar la planificación","El plan semanal muestra caja adicional por el faltante de material.","Revisar necesidad","4.800.000 PYG de caja adicional del plan no es el valor total de la obra.",[field("Necesidad adicional PYG","4800000","number")]),
    step("Tomar la decisión","Contrastá fechas de cobro y pago antes de comprometer una compra.","Revisar proyección","La proyección acompaña la decisión; no ejecuta por sí sola pagos ni cobros.")
  ],[],"/tesoreria","Básico"),
  guide("rodrigo","Trabajar con Rodrigo y aprobaciones","Asistencia","Mascota Rodrigo → panel / Actividad","Consultá y prepará acciones respetando el rol y las confirmaciones.","Cuenta activa; las integraciones reales requieren configuración.",["components/agent/rodrigo-agent-widget.tsx","app/(internal)/agent/approval-actions.ts","lib/agent/rodrigo-chat.ts"],[
    step("Pedir una consulta","Usá una petición concreta y revisá el contexto de obra.","Consultar ejemplo","El asistente puede responder o preparar trabajo según sus herramientas habilitadas.",[field("Petición","Consultar el stock de cemento")]),
    step("Revisar la propuesta","No confundas tarea preparada con orden emitida o correo enviado.","Revisar propuesta de ejemplo","Las acciones sujetas a aprobación requieren la decisión de una persona autorizada."),
    step("Confirmar y verificar","Verificá el resultado en Actividad y en el documento real.","Aprobar ejemplo","Aprobar en esta simulación no ejecuta herramientas, no envía correos y no consume IA real.")
  ],[],"/agent/activity","Todos",["Comercial",...adminRoles]),
  guide("control-scanner","Adjuntar un documento desde el celular","Asistencia","Facturas → Escanear desde celular / scanner móvil","Conectá móvil y PC, prepará el PDF y revisá su adjunto antes de guardar.","Para factura: Administración o Admin y una sesión propia vigente. En general, depende del contexto autorizado.",["app/api/scanner/session/route.ts","lib/scanner/session-access.ts","lib/scanner/session-service.ts","app/(internal)/invoices/actions.ts"],[
    step("Crear la sesión","En la PC, abrí el escaneo desde el formulario de factura y usá su QR/PIN temporal.","Vincular móvil de ejemplo","La sesión real queda vinculada a empresa, creador y contexto permitido."),
    step("Preparar el documento","Capturá y revisá las páginas; la detección de bordes es una ayuda que puede requerir corrección.","Preparar PDF de ejemplo","La subida directa soporta hasta 20 MiB y no confirma todavía una factura.",[choice("Archivo a enviar","PDF de 20 MiB",["PDF de 20 MiB","PDF de 21 MiB"])]),
    step("Comprobar el adjunto en la PC","Esperá el estado completado y revisá legibilidad e identidad antes de guardar.","Adjuntar ejemplo","El adjunto real se valida contra la sesión y su referencia exacta. Digitalizar no significa leer correctamente ni registrar la factura.")
  ],["Revisá siempre el adjunto y los datos extraídos antes de guardar la factura."],"/invoices","Todos",["Comercial",...adminRoles]),
  guide("mocks","Practicar y pasar al módulo real","Asistencia","Instructivo interactivo","Usá los ejemplos, retomá tu avance y diferenciá aprendizaje de operación real.","Este navegador. Los permisos de los módulos reales siguen aplicándose.",["scripts/e2e/seed-canonical-demo.ts","tests/e2e/auth.setup.ts"],[
    step("Usar datos ficticios","Los formularios del instructivo no escriben en la empresa.","Empezar práctica","Podés equivocarte y repetir sin crear facturas ni movimientos."),
    step("Comprobar el resultado","Cada paso espera los valores de su ejercicio y explica qué debería pasar.","Completar ejercicio","El progreso guarda únicamente identificadores y pasos, no los datos que escribiste.",[field("Código de práctica","OBR-DEMO")]),
    step("Operar con contexto real","El botón del módulo real abre la pantalla habitual, sujeta a tus permisos.","Terminar preparación","Los datos guardados en el módulo real sí afectan a la empresa. La práctica completada no certifica una operación real.")
  ],[],"/dashboard","Todos",["Comercial",...adminRoles])
];

export const MODULES = ["Empezar","Preparar","Comprar","Avance de obra","Certificar","Vender y cobrar","Asistencia"];
export const JOURNEYS = [
  {id:"preparar",title:"Tu primera obra",description:"Del proyecto a una semana preparada.",ids:["crear-proyecto","presupuesto","costeo","cronograma","plan-semanal"]},
  {id:"abastecer",title:"Comprar y ejecutar",description:"Del proveedor al material y al avance real.",ids:["proveedores","rfqs","ordenes-compra","recepciones","stock","ejecucion","basico-facturas","basico-pagos"]},
  {id:"certificar",title:"Certificar y cobrar",description:"Del trabajo reconocido al saldo del cliente.",ids:["cert-comitente","clientes","facturas-venta","cobros","informes"]}
];

export function normalizePractice(value: string) { return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").toLocaleLowerCase("es"); }
export function validatePractice(step: PracticeStep, values: string[]): string | null {
  for(let i=0;i<step.fields.length;i++) {
    const f=step.fields[i],v=values[i]??"";
    if(f.type==="number" ? !v.trim() || !Number.isFinite(Number(v)) || Number(v)!==Number(f.sample) : normalizePractice(v)!==normalizePractice(f.sample)) return `Para este ejercicio, usá «${f.sample}» en ${f.label}.`;
  }
  return null;
}
