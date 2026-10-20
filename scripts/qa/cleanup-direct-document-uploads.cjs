// QA only. Default is read-only; --apply removes abandoned temporary objects.
// Never deletes final evidence or changes any other bucket/project.
const { db, ref, assert } = require('./phase6/context.cjs');
const bucket = 'direct-document-uploads';
const cutoff = Date.now() - 3 * 60 * 60 * 1000;
(async () => {
  assert.equal(ref, 'kyiihlkncatojvlasoag');
  const storage = db.storage.from(bucket);
  const paths = [];
  for (let offset = 0;; offset += 100) {
    const roots = await storage.list('', { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (roots.error) throw Error('No se pudo listar el bucket temporal de QA.');
    for (const folder of roots.data) {
      if (!/^[a-f0-9]{64}$/.test(folder.name) || folder.id) continue;
      for (let inner = 0;; inner += 100) {
        const objects = await storage.list(folder.name, { limit: 100, offset: inner, sortBy: { column: 'name', order: 'asc' } });
        if (objects.error) throw Error('No se pudieron listar cargas pendientes.');
        for (const object of objects.data) {
          if (object.id && /^[a-f0-9-]{36}$/.test(object.name) && object.created_at && object.updated_at
            && Date.parse(object.created_at) < cutoff && Date.parse(object.updated_at) < cutoff) paths.push(folder.name + '/' + object.name);
        }
        if (objects.data.length < 100) break;
      }
    }
    if (roots.data.length < 100) break;
  }
  if (process.argv.includes('--apply')) {
    for (let index = 0; index < paths.length; index += 100) {
      const result = await storage.remove(paths.slice(index, index + 100));
      if (result.error) throw Error('La limpieza quedó incompleta.');
    }
  }
  console.log(JSON.stringify({ project: ref, bucket, mode: process.argv.includes('--apply') ? 'apply' : 'read-only', eligibleObjects: paths.length, minimumAgeHours: 3 }));
})().catch(() => { console.error('Falló la limpieza del bucket temporal de QA.'); process.exitCode = 1; });
