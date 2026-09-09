import XLSX from "xlsx";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cómputo métrico típico de una obra de construcción — pensado para probar
// "Importar Excel" en Presupuesto dentro de un proyecto (Obra 1).
// Fechas en secuencia lógica de obra (dd/mm/aaaa) — arranca 2026-09-15.
const rows = [
  ["Código", "Descripción", "Unidad", "Cantidad", "Precio Unitario", "Fecha Inicio", "Fecha Fin"],
  ["1.1", "Limpieza y desmalezamiento del terreno", "m²", 850, "8.500", "15/09/2026", "18/09/2026"],
  ["1.2", "Replanteo y trazado de obra", "m²", 850, "5.000", "19/09/2026", "21/09/2026"],
  ["2.1", "Excavación de zapatas y vigas de fundación", "m³", 120, "95.000", "22/09/2026", "29/09/2026"],
  ["2.2", "Relleno y compactación con suelo seleccionado", "m³", 60, "72.000", "30/09/2026", "03/10/2026"],
  ["2.3", "Hormigón ciclópeo para fundaciones", "m³", 45, "680.000", "04/10/2026", "10/10/2026"],
  ["3.1", "Columnas de hormigón armado 20x20", "m³", 28, "1.850.000", "11/10/2026", "20/10/2026"],
  ["3.2", "Vigas de hormigón armado", "m³", 22, "1.780.000", "21/10/2026", "28/10/2026"],
  ["3.3", "Losa de hormigón armado e=12cm", "m²", 850, "295.000", "29/10/2026", "07/11/2026"],
  ["4.1", "Mampostería de ladrillo visto 15cm", "m²", 620, "185.000", "08/11/2026", "20/11/2026"],
  ["4.2", "Mampostería de ladrillo hueco 20cm (interior)", "m²", 340, "98.000", "10/11/2026", "18/11/2026"],
  ["5.1", "Revoque grueso y fino interior", "m²", 1450, "45.000", "21/11/2026", "05/12/2026"],
  ["5.2", "Revoque grueso y fino exterior", "m²", 620, "52.000", "21/11/2026", "01/12/2026"],
  ["6.1", "Contrapiso de hormigón pobre e=8cm", "m²", 850, "38.000", "06/12/2026", "10/12/2026"],
  ["6.2", "Piso cerámico 60x60 (interior)", "m²", 780, "165.000", "11/12/2026", "22/12/2026"],
  ["6.3", "Piso porcelanato exterior antideslizante", "m²", 70, "220.000", "11/12/2026", "15/12/2026"],
  ["7.1", "Cubierta de chapa trapezoidal galvanizada", "m²", 900, "125.000", "02/12/2026", "12/12/2026"],
  ["7.2", "Estructura metálica para cubierta", "kg", 4200, "18.500", "25/11/2026", "01/12/2026"],
  ["7.3", "Cielorraso de yeso suspendido", "m²", 780, "95.000", "23/12/2026", "05/01/2027"],
  ["8.1", "Instalación eléctrica completa (puntos de luz y tomas)", "punto", 180, "185.000", "06/12/2026", "20/12/2026"],
  ["8.2", "Tablero eléctrico general y térmicas", "gl", 1, "8.500.000", "18/12/2026", "20/12/2026"],
  ["9.1", "Instalación sanitaria de agua fría y caliente", "punto", 45, "220.000", "06/12/2026", "16/12/2026"],
  ["9.2", "Instalación de desagüe cloacal y pluvial", "punto", 38, "195.000", "06/12/2026", "14/12/2026"],
  ["10.1", "Carpintería de aluminio — ventanas", "m²", 95, "680.000", "06/01/2027", "16/01/2027"],
  ["10.2", "Puertas de madera interiores (incluye marco y herrajes)", "un", 22, "1.250.000", "17/01/2027", "23/01/2027"],
  ["10.3", "Portón de acceso vehicular metálico", "un", 1, "4.800.000", "17/01/2027", "20/01/2027"],
  ["11.1", "Pintura látex interior (2 manos)", "m²", 1450, "22.000", "24/01/2027", "05/02/2027"],
  ["11.2", "Pintura exterior impermeabilizante", "m²", 620, "35.000", "21/01/2027", "30/01/2027"],
  ["12.1", "Limpieza final de obra", "m²", 850, "12.000", "06/02/2027", "08/02/2027"],
];

const ws = XLSX.utils.aoa_to_sheet(rows);
ws["!cols"] = [{ wch: 8 }, { wch: 50 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Presupuesto");

const outPath = join(__dirname, "presupuesto-obra1.xlsx");
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(outPath, buf);
console.log(`✓ ${outPath}`);
