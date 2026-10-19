const {root,env}=require('./context.cjs');
const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['--require','./scripts/qa/phase6/fault-preload.cjs','node_modules/next/dist/bin/next','start','-p','3019','-H','127.0.0.1'],{cwd:root,env:{...process.env,...env,CRON_SECRET:'isolated-audit-clock-fixture'},windowsHide:true,stdio:'inherit'});
child.on('exit',code=>process.exit(code||0));
process.on('exit',()=>child.kill());
