async function inspectAllCategories() {
  const allCatDetails = new Map();
  const sampleRecords = [];

  // Sample across 2020 to 2026: 4 pages of 50 for each year
  for (let y = 2020; y <= 2026; y++) {
    for (const page of [1, 5, 10, 20]) {
      const url = `https://www.contrataciones.gov.py/datos/api/v3/doc/search/processes?tipo_fecha=publicacion_llamado&fecha_desde=${y}-01-01&fecha_hasta=${y}-12-31&order=date asc&page=${page}&items_per_page=50`;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) continue;
        const data = await res.json();
        for (const r of data.records || []) {
          const t = r.compiledRelease?.tender;
          if (!t) continue;
          const cat = t.mainProcurementCategory || 'NONE';
          const catDet = t.mainProcurementCategoryDetails || 'NONE';
          const key = `${cat} ||| ${catDet}`;
          allCatDetails.set(key, (allCatDetails.get(key) || 0) + 1);

          if (sampleRecords.length < 50 && (cat === 'works' || catDet.toLowerCase().includes('obra') || catDet.toLowerCase().includes('construc'))) {
            sampleRecords.push({
              ocid: r.ocid,
              title: t.title,
              cat,
              catDet
            });
          }
        }
      } catch (err) {
        console.error(`Error at ${y} p${page}:`, err.message);
      }
    }
  }

  console.log('\n--- ALL OBSERVED CATEGORIES (cat ||| catDet) ---');
  const sorted = Array.from(allCatDetails.entries()).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    console.log(`[${v}] ${k}`);
  }

  console.log('\n--- SAMPLE WORKS / CONSTRUCTION RECORDS ---');
  for (const s of sampleRecords.slice(0, 10)) {
    console.log(s);
  }
}

inspectAllCategories().catch(console.error);
