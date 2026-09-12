async function inspectYearsTotals() {
  const years = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  let grandTotal = 0;
  for (const y of years) {
    const hasta = `${y}-12-31`;
    const url = `https://www.contrataciones.gov.py/datos/api/v3/doc/search/processes?tipo_fecha=publicacion_llamado&fecha_desde=${y}-01-01&fecha_hasta=${hasta}&items_per_page=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    const count = data.pagination?.total_items || 0;
    grandTotal += count;
    console.log(`Year ${y}: ${count} total processes`);
  }
  console.log(`GRAND TOTAL 2020-PRESENT: ${grandTotal}`);
}
inspectYearsTotals().catch(console.error);
