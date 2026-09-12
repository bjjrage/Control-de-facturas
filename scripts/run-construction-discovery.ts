import { HistoricalDncpEnumerator } from "../lib/procurement/historical-enumerator";
import { classifyProcess } from "../lib/procurement/construction-classifier";

interface YearSummary {
  year: number;
  totalProcesses: number;
  constructionCount: number;
  byBucket: Record<string, number>;
  byMethod: Record<string, number>;
}

async function runDiscovery() {
  console.log('================================================================================');
  console.log('OFFICIAL DNCP 2020-PRESENT CONSTRUCTION UNIVERSE ENUMERATION & DISCOVERY PASS');
  console.log('================================================================================\n');

  const enumerator = new HistoricalDncpEnumerator(2020, 2026);
  // Filter windows 2020 to 2026
  const windows = enumerator.windows;

  const yearStats: Record<number, YearSummary> = {};
  const globalBuckets: Record<string, number> = {};
  const globalMethods: Record<string, number> = {
    STRUCTURED_WORKS: 0,
    STRUCTURED_CATEGORY: 0,
    TEXT_INCLUSION: 0,
  };

  const sampleConstruction: any[] = [];
  const sampleNonConstruction: any[] = [];
  const removedTier3Records: any[] = [];

  let grandTotal = 0;
  let grandConstruction = 0;
  let oldConstructionCount = 15912;

  for (let y = 2020; y <= 2026; y++) {
    yearStats[y] = {
      year: y,
      totalProcesses: 0,
      constructionCount: 0,
      byBucket: {},
      byMethod: {},
    };
  }

  for (const win of windows) {
    console.log(`\n>>> Processing Window [${win.id}] (${win.desde}..${win.hasta}) <<<`);
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const { records, pagination } = await enumerator.fetchSearchPage(win, page, 50);
      totalPages = pagination.total_pages || totalPages;
      if (page === 1) {
        console.log(`  Window ${win.id}: Total items = ${pagination.total_items}, Pages = ${totalPages}`);
      }

      grandTotal += records.length;
      yearStats[win.year].totalProcesses += records.length;

      for (const rec of records) {
        const tender = rec.compiledRelease?.tender || {};
        const title = tender.title || '';
        const ocid = rec.ocid || tender.id;

        const res = classifyProcess(tender);

        if (res.isConstructionRelevant) {
          grandConstruction++;
          yearStats[win.year].constructionCount++;
          const b = res.bucket || 'OTHER_CONSTRUCTION_RELEVANT';
          yearStats[win.year].byBucket[b] = (yearStats[win.year].byBucket[b] || 0) + 1;
          yearStats[win.year].byMethod[res.method] = (yearStats[win.year].byMethod[res.method] || 0) + 1;
          globalBuckets[b] = (globalBuckets[b] || 0) + 1;
          globalMethods[res.method] = (globalMethods[res.method] || 0) + 1;

          if (sampleConstruction.length < 50 && Math.random() < 0.1) {
            sampleConstruction.push({
              ocid,
              title,
              catDet: tender.mainProcurementCategoryDetails,
              bucket: res.bucket,
              method: res.method,
            });
          }
        } else {
          // Check if this was a candidate under mixed maintenance/materials categories
          // that got excluded
          const catDet = tender.mainProcurementCategoryDetails || '';
          if (
            (catDet.includes('Mantenimientos y reparaciones') ||
             catDet.includes('Materiales e insumos') ||
             catDet.includes('Servicios Técnicos') ||
             catDet.includes('Servicios basados en ingenieria')) &&
            removedTier3Records.length < 50
          ) {
            removedTier3Records.push({
              ocid,
              title,
              catDet,
              reason: res.reason,
            });
          }

          if (sampleNonConstruction.length < 50 && Math.random() < 0.05) {
            sampleNonConstruction.push({
              ocid,
              title,
              catDet: tender.mainProcurementCategoryDetails,
              method: res.method,
            });
          }
        }
      }

      if (page % 20 === 0 || page === totalPages) {
        process.stdout.write(` [p${page}/${totalPages}]`);
      }
      page++;
    }
  }

  console.log('\n\n================================================================================');
  console.log('ENUMERATION COMPLETE — SUMMARY RESULTS');
  console.log('================================================================================');
  console.log(`TOTAL_DNCP_PROCESSES_2020_PRESENT = ${grandTotal}`);
  console.log(`CONSTRUCTION_RELEVANT = ${grandConstruction}`);
  console.log(`CONSTRUCTION_SHARE = ${((grandConstruction / grandTotal) * 100).toFixed(2)}%`);

  console.log('\n--- BY YEAR ---');
  for (let y = 2020; y <= 2026; y++) {
    const s = yearStats[y];
    const pct = s.totalProcesses > 0 ? ((s.constructionCount / s.totalProcesses) * 100).toFixed(2) : '0';
    console.log(`${y}: Total = ${s.totalProcesses} | Construction = ${s.constructionCount} (${pct}%)`);
  }

  console.log('\n--- BY BUCKET ---');
  for (const [b, count] of Object.entries(globalBuckets).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / grandConstruction) * 100).toFixed(2);
    console.log(`  ${b}: ${count} (${pct}%)`);
  }

  console.log('\n--- CLASSIFICATION METHOD BREAKDOWN ---');
  const structuredCount = (globalMethods.STRUCTURED_WORKS || 0) + (globalMethods.STRUCTURED_CATEGORY || 0);
  const textCount = globalMethods.TEXT_INCLUSION || 0;
  console.log(`  STRUCTURED CLASSIFICATION: ${structuredCount} (${((structuredCount / grandConstruction) * 100).toFixed(2)}%)`);
  console.log(`  TEXT FALLBACK INCLUSION: ${textCount} (${((textCount / grandConstruction) * 100).toFixed(2)}%)`);

  // Write sample datasets for quality check audit
  import('node:fs').then(fs => {
    fs.writeFileSync('data/sample-construction-50.json', JSON.stringify(sampleConstruction.slice(0, 50), null, 2));
    fs.writeFileSync('data/sample-non-construction-50.json', JSON.stringify(sampleNonConstruction.slice(0, 50), null, 2));
    fs.writeFileSync('data/sample-removed-tier3-30.json', JSON.stringify(removedTier3Records.slice(0, 30), null, 2));
    fs.writeFileSync('data/construction-discovery-summary.json', JSON.stringify({
      grandTotal,
      grandConstruction,
      oldConstructionCount,
      removedCount: oldConstructionCount - grandConstruction,
      yearStats,
      globalBuckets,
      globalMethods,
    }, null, 2));
    console.log('\nSamples written to data/sample-construction-50.json, data/sample-non-construction-50.json and data/sample-removed-tier3-30.json');
  });
}

runDiscovery().catch(console.error);
