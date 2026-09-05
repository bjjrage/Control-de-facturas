// Genera un Excel de presupuesto de obra realista para probar "Importar
// Excel" en la tab Presupuesto del Módulo Construcción. Códigos con
// jerarquía (1, 1.1, 1.2...) para probar la detección automática de rubros.
//
// Correr: node mock-data/construccion/generate-mock-budget.mjs
import XLSX from "xlsx";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

XLSX.set_fs(fs);

const __dirname = dirname(fileURLToPath(import.meta.url));

const rows = [
  ["Código", "Descripción", "Unidad", "Cantidad", "Precio Unitario"],
  ["1", "MOVIMIENTO DE SUELOS", "", "", ""],
  ["1.1", "Limpieza y desmalezado del terreno", "m2", 450, "8.500"],
  ["1.2", "Excavación manual para fundaciones", "m3", 38, "95.000"],
  ["1.3", "Relleno y compactación", "m3", 25, "65.000"],
  ["2", "ESTRUCTURA DE HORMIGÓN ARMADO", "", "", ""],
  ["2.1", "Hormigón para zapatas H-21", "m3", 18, "1.250.000"],
  ["2.2", "Hormigón para columnas H-21", "m3", 12, "1.380.000"],
  ["2.3", "Hormigón para losa H-21", "m3", 32, "1.320.000"],
  ["2.4", "Acero de refuerzo diámetro 12mm", "kg", 2400, "18.500"],
  ["2.5", "Encofrado de madera", "m2", 210, "85.000"],
  ["3", "MAMPOSTERÍA", "", "", ""],
  ["3.1", "Levantamiento de paredes ladrillo común", "m2", 380, "145.000"],
  ["3.2", "Revoque grueso interior/exterior", "m2", 720, "45.000"],
  ["3.3", "Revoque fino y terminación", "m2", 720, "38.000"],
  ["4", "TECHOS Y CUBIERTAS", "", "", ""],
  ["4.1", "Estructura metálica para techo", "m2", 180, "165.000"],
  ["4.2", "Cubierta de chapa trapezoidal", "m2", 180, "98.000"],
  ["4.3", "Cielorraso de yeso", "m2", 165, "72.000"],
  ["5", "INSTALACIONES", "", "", ""],
  ["5.1", "Instalación eléctrica completa", "gl", 1, "28.000.000"],
  ["5.2", "Instalación sanitaria completa", "gl", 1, "22.000.000"],
  ["6", "PISOS Y REVESTIMIENTOS", "", "", ""],
  ["6.1", "Contrapiso de hormigón pobre", "m2", 165, "42.000"],
  ["6.2", "Piso cerámico 45x45", "m2", 150, "125.000"],
  ["6.3", "Revestimiento cerámico en baños y cocina", "m2", 45, "98.000"],
  ["7", "CARPINTERÍA", "", "", ""],
  ["7.1", "Puertas interiores de madera", "u", 8, "850.000"],
  ["7.2", "Ventanas de aluminio con vidrio", "m2", 32, "680.000"],
  ["8", "PINTURA Y TERMINACIONES", "", "", ""],
  ["8.1", "Pintura interior látex", "m2", 620, "22.000"],
  ["8.2", "Pintura exterior", "m2", 280, "28.000"],
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws["!cols"] = [{ wch: 8 }, { wch: 42 }, { wch: 8 }, { wch: 10 }, { wch: 16 }];
XLSX.utils.book_append_sheet(wb, ws, "Presupuesto");

const outPath = join(__dirname, "presupuesto-obra-ejemplo.xlsx");
XLSX.writeFile(wb, outPath);
console.log("Generado:", outPath);
