async function surveyCategories() {
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  const allCatDetails = new Map();
  for (const y of years) {
    const url = `https://www.contrataciones.gov.py/datos/api/v3/doc/search/processes?tipo_fecha=publicacion_llamado&fecha_desde=${y}-03-01&fecha_hasta=${y}-03-15&items_per_page=50`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    for (const r of data.records || []) {
      const cd = r.compiledRelease?.tender?.mainProcurementCategoryDetails || 'UNKNOWN';
      allCatDetails.set(cd, (allCatDetails.get(cd) || 0) + 1);
    }
  }
  console.log('Category details found in survey:');
  for (const [k, v] of allCatDetails.entries()) {
    console.log(`[${v}] ${k}`);
  }
}
surveyCategories().catch(console.error);
