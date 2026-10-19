// Explicit audit-only process instrumentation. Never imported by the product.
// Real Supabase requests go ONLY to the isolated host, with original headers.
const http = require('node:http');
const target = 'kyiihlkncatojvlasoag.supabase.co';
const realFetch = global.fetch;
let rules = [], fixedTime = null;
const events = [];
const NativeDate = Date;
global.Date = class extends NativeDate {
 constructor(...args) { super(...(args.length ? args : [fixedTime ?? NativeDate.now()])); }
 static now() { return fixedTime ?? NativeDate.now(); }
 static parse(value) { return NativeDate.parse(value); }
 static UTC(...args) { return NativeDate.UTC(...args); }
};
global.fetch = async (input, init) => {
 const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
 const method = init?.method || input?.method || 'GET';
 if (url.hostname.endsWith('.supabase.co') && url.hostname !== target) throw new Error('Refusing a non-isolated Supabase host in QA');
 if (url.hostname !== target) return realFetch(input, init);
 const rule = rules.find(r => new RegExp(r.match).test(method + ' ' + decodeURIComponent(url.pathname + url.search)));
 if (!rule) return realFetch(input, init);
 if (rule.once !== false) rules = rules.filter(r => r !== rule);
 const event = { method, path: url.pathname, kind: rule.kind, at: new NativeDate().toISOString() };
 events.push(event);
 if (rule.kind === 'fail') return Response.json({ code: rule.code || 'XX000', message: 'QA controlled database failure' }, { status: 500 });
 const result = await realFetch(input, init);
 event.upstreamStatus = result.status;
 if (rule.kind === 'lost') { await result.arrayBuffer(); throw new TypeError('QA response lost AFTER upstream completion'); }
 if (rule.kind === 'hold') {
  // Capture a real snapshot, then allow a concurrent real transaction before delivery.
  const bytes = await result.arrayBuffer(); event.waiting = true;
  await new Promise(resolve => { event.release = resolve; }); delete event.release; event.waiting = false;
  return new Response(bytes, { status: result.status, headers: result.headers });
 }
 return result;
};
http.createServer(async (req,res) => {
 const url = new URL(req.url,'http://localhost');
 if(req.method==='POST') {
  let text=''; for await(const c of req)text+=c;
  const body=JSON.parse(text || '{}');
  if(url.pathname==='/rules') rules=body;
  if(url.pathname==='/clock') fixedTime=body.at?NativeDate.parse(body.at):null;
  if(url.pathname==='/release') for(const e of events)e.release?.();
 }
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify({events:events.map(({release,...e})=>e),rules,clock:fixedTime}));
}).listen(4018,'127.0.0.1',()=>console.log('QA instrumentation :4018; upstream pinned to '+target));
