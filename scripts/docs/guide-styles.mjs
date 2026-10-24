// Estilos compartidos y autocontenidos de los dos HTML. Sin recursos de red.
export const GUIDE_STYLES = `
:root {
  color-scheme: light;
  --ink: #172638;
  --muted: #43556c;
  --bg: #eaf0f7;
  --line: #bccbdd;
  --accent: #1d4ed8;
  --wash: #eff6ff;
  --nav: #132238;
  --area: #1d4ed8;
  --area-dark: #1e3a8a;
  --area-wash: #eff6ff;
  --area-line: #93b7ed;
  --area-nav: #93c5fd;
}
[data-area="empezar"] {--area:#1d4ed8;--area-dark:#1e3a8a;--area-wash:#eff6ff;--area-line:#93b7ed;--area-nav:#93c5fd}
[data-area="comprar"] {--area:#92400e;--area-dark:#78350f;--area-wash:#fffbeb;--area-line:#dba94a;--area-nav:#fcd34d}
[data-area="materiales"] {--area:#0e7490;--area-dark:#155e75;--area-wash:#ecfeff;--area-line:#6ab7c7;--area-nav:#67e8f9}
[data-area="vender"] {--area:#6d28d9;--area-dark:#5b21b6;--area-wash:#f5f3ff;--area-line:#b49ae5;--area-nav:#c4b5fd}
[data-area="finanzas"] {--area:#166534;--area-dark:#14532d;--area-wash:#f0fdf4;--area-line:#7bb58c;--area-nav:#86efac}
[data-area="obra"] {--area:#c2410c;--area-dark:#9a3412;--area-wash:#fff7ed;--area-line:#e5a775;--area-nav:#fdba74}
[data-area="licitar"] {--area:#4338ca;--area-dark:#3730a3;--area-wash:#eef2ff;--area-line:#a0a7e6;--area-nav:#a5b4fc}
[data-area="asistencia"] {--area:#9d174d;--area-dark:#831843;--area-wash:#fdf2f8;--area-line:#d595b4;--area-nav:#f9a8d4}
* {box-sizing:border-box}
html {scroll-behavior:smooth;scroll-padding-top:28px}
body {margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
button,input,select {font:inherit}
a {color:#1744a2;text-decoration-thickness:1px;text-underline-offset:3px;border-radius:3px}
a,button,summary,input,select {transition:background-color .14s ease,border-color .14s ease,color .14s ease,box-shadow .14s ease,transform .14s ease}
a:hover {color:#102f7b;background:#dbeafe;text-decoration-thickness:2px}
:focus-visible {outline:3px solid #2563eb;outline-offset:3px;box-shadow:0 0 0 6px #fff}
button {min-height:42px;cursor:pointer;border:1px solid #94a6be;border-radius:8px;background:#fff;padding:8px 14px;color:#172638;font-weight:650;box-shadow:0 1px 2px #1726380d}
button:hover {background:#dbeafe;color:#102f7b;border-color:#1d4ed8;box-shadow:0 3px 9px #1d4ed826;transform:translateY(-1px)}
button:active {transform:translateY(0);background:#cbdcf6;box-shadow:inset 0 1px 3px #17263833}
button:disabled {cursor:default;opacity:.55;transform:none;box-shadow:none}
#print {background:#1d4ed8;border-color:#1d4ed8;color:#fff}
#print:hover {background:#173b9f;border-color:#173b9f;box-shadow:0 4px 12px #1d4ed840}
#print:active {background:#102f7b}
h1,h2,h3,h4 {line-height:1.25;letter-spacing:-.025em}
h1 {font-size:clamp(2rem,4vw,3.3rem);margin:12px 0 20px;max-width:850px;color:#0f2037}
h2 {font-size:1.8rem;margin:0 0 12px;color:#142944}
h3 {font-size:1.22rem;margin:0;color:#172638}
h4 {font-size:1rem;margin:24px 0 8px;color:#172638}
p {margin:0 0 14px}
li {padding-left:3px}
li+li {margin-top:10px}
li::marker {font-weight:750;color:var(--area)}
ul,ol {padding-left:24px}
code {font:13px/1.5 ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
small,.muted {color:var(--muted)}
[hidden] {display:none!important}
.skip {position:absolute;left:12px;top:-100px;z-index:5;background:white;padding:10px}
.skip:focus {top:12px}
.shell {display:grid;grid-template-columns:275px minmax(0,1fr);min-height:100vh}
.sidebar {background:var(--nav);color:#e0e9f5;padding:28px 22px;position:sticky;top:0;height:100vh;overflow-y:auto;border-right:1px solid #314561}
.brand {color:#fff;font-weight:750;line-height:1.25;display:block;text-decoration:none;margin:0 0 8px;padding:4px}
.brand:hover {color:#fff;background:#2b405d}
.sidebar p {font-size:13px;color:#c2d1e4}
.sidebar summary {font-weight:650;color:white;cursor:pointer;margin:12px 0;padding:7px;border-radius:7px}
.sidebar summary:hover {background:#2b405d;color:#fff}
.sidebar :focus-visible {outline-color:#fbbf24;box-shadow:none}
.sidebar nav>a {display:block;color:#f1f5fb;border:1px solid #6f85a1;border-radius:7px;padding:9px 11px;margin:15px 0;text-decoration:none;font-size:14px}
.sidebar nav>a:hover {background:#2b405d;border-color:#a9c6f0;color:white;transform:translateX(2px)}
.nav-group {margin:22px 0}
.nav-label {font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--area-nav);font-weight:750;padding:5px 8px;border-left:4px solid var(--area-nav);margin-bottom:8px}
.nav-group a {display:block;color:#dce6f3;text-decoration:none;font-size:13px;line-height:1.45;padding:7px 8px;min-height:33px;border-left:2px solid transparent;border-radius:0 5px 5px 0}
.nav-group a:hover,.nav-group a[aria-current="location"] {background:#2b405d;color:#fff;border-left-color:var(--area-nav);transform:translateX(2px)}
body[data-kind="flow"] .nav-group a {border-left-color:var(--area-nav)}
.main {min-width:0;padding:48px clamp(22px,4vw,68px) 70px;max-width:1280px;width:100%;margin:auto}
.eyebrow {font-size:12px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:#1d4ed8}
.lead {font-size:1.15rem;max-width:780px;color:#344a65}
.meta {display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}
.tag {border:1px solid #b8c6d8;border-radius:5px;padding:4px 8px;font-size:12px;line-height:1.5;background:#f8fafc;color:#31455f}
.tag.green {background:#e8efff;border-color:#9fb7e2;color:#183a82;font-weight:650}
.notice {position:relative;border:1px solid #a5bfeb;border-left:5px solid #1d4ed8;background:#eff6ff;padding:20px 23px;border-radius:0 10px 10px 0;margin:22px 0;color:#17365e}
.notice p:last-child {margin-bottom:0}
.workspace-grid {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:24px 0}
.workspace {border:1px solid var(--area-line);border-top:5px solid var(--area);background:var(--area-wash);padding:19px;border-radius:10px;box-shadow:0 2px 4px #17263808}
.workspace h3 {font-size:1.05rem;margin:0 0 10px;color:var(--area-dark)}
.workspace p {font-size:14px;margin:0;color:#30435a}
.section {margin-top:44px;scroll-margin-top:28px}
.panel {background:#fff;border:1px solid var(--line);border-radius:12px;padding:24px;margin:20px 0;box-shadow:0 2px 4px #17263808}
.table-wrap {overflow-x:auto}
table {width:100%;border-collapse:collapse;font-size:14px;text-align:left}
th,td {padding:13px;vertical-align:top;border-bottom:1px solid #c7d3e3}
th {background:#213b5a;color:white;font-size:12px;text-transform:uppercase;letter-spacing:.035em}
td:first-child {font-weight:650;color:#142944}
tbody tr:nth-child(even) {background:#f1f5fa}
.toolbar {display:grid;grid-template-columns:minmax(160px,1fr) minmax(170px,.6fr);gap:14px;padding:22px;background:#dce6f3;border:1px solid #a6b9d3;border-radius:12px;margin:28px 0 18px}
.toolbar label {display:block;font-size:13px;font-weight:750;color:#243a57}
.toolbar input,.toolbar select {display:block;width:100%;margin-top:6px;min-height:44px;padding:10px 12px;background:white;color:#172638;border:1px solid #7f95b2;border-radius:8px;min-width:0}
.toolbar input::placeholder {color:#586b84}
.toolbar input:hover,.toolbar select:hover {border-color:#1d4ed8;box-shadow:0 0 0 1px #1d4ed8}
.toolbar input:focus,.toolbar select:focus {border-color:#1d4ed8;background:#fff}
.toolbar .actions {grid-column:1/-1;display:flex;flex-wrap:wrap;gap:9px;align-items:center}
.counter {font-size:13px;color:#314761;margin-left:auto;font-weight:650}
.group-head {display:flex;gap:15px;align-items:center;margin:0 0 18px;padding:17px 20px;background:var(--area-wash);border:1px solid var(--area-line);border-left:5px solid var(--area);border-radius:9px}
.area-number {display:grid;place-items:center;flex:0 0 40px;width:40px;height:40px;border-radius:9px;color:white;background:var(--area);font-size:14px;font-weight:800;font-variant-numeric:tabular-nums}
.group-head h2 {margin:0;color:var(--area-dark);font-size:1.6rem}
.group-head p {font-size:14px;color:#374b64;margin:5px 0 0}
.module {background:white;border:1px solid var(--line);border-left:5px solid var(--area);border-radius:10px;margin:14px 0;scroll-margin-top:25px;box-shadow:0 2px 4px #17263808}
.module:hover {border-color:var(--area);box-shadow:0 5px 14px #17263816}
.module[open] {border-color:var(--area);box-shadow:0 4px 12px #17263812}
.module>summary {padding:20px 24px;cursor:pointer;position:relative;list-style:none;padding-right:68px;border-radius:5px}
.module>summary::-webkit-details-marker {display:none}
.module>summary:hover {background:var(--area-wash)}
.module[open]>summary {background:var(--area-wash)}
.module>summary:after {content:'+';position:absolute;right:20px;top:24px;width:30px;height:30px;display:grid;place-items:center;border:1px solid var(--area-line);border-radius:7px;background:var(--area-wash);font-size:22px;font-weight:650;color:var(--area-dark);line-height:1}
.module>summary:hover:after,.module[open]>summary:after {background:var(--area);border-color:var(--area);color:white}
.module[open]>summary:after {content:'−'}
.card-kicker {display:block;font-size:11px;line-height:1.5;font-weight:750;letter-spacing:.07em;text-transform:uppercase;color:var(--area-dark);margin-bottom:7px}
.card-number {font-variant-numeric:tabular-nums;display:inline-block;border-right:1px solid var(--area-line);padding-right:8px;margin-right:8px}
.module>summary h3 {font-size:1.2rem;font-weight:750;color:#172638}
.module>summary p {margin:9px 0 0;color:#43556c;font-size:14px;max-width:80ch}
.module-body {padding:0 24px 26px;border-top:1px solid var(--area-line)}
.module-body>p,.module-body li {max-width:82ch}
.module-body ol {padding:18px 22px 18px 43px;background:#f4f7fb;border:1px solid #d1dce9;border-radius:9px;margin:10px 0 22px}
.module-body h4 {display:flex;align-items:center;gap:8px}
.module-body h4:before {content:'';width:5px;height:17px;flex-shrink:0;border-radius:2px;background:var(--area)}
.location {margin-top:22px;padding:13px 15px;background:var(--area-wash);border:1px solid var(--area-line);border-radius:7px;font-size:14px;color:var(--area-dark)}
.badges {display:flex;flex-wrap:wrap;gap:7px;margin:15px 0}
.result {margin-top:22px;padding:17px 19px;background:#eef9f1;border:1px solid #8dbf9c;border-left:4px solid #166534;border-radius:8px;color:#173d25}
.result strong {display:flex;align-items:center;gap:9px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:7px;color:#14532d}
.result strong:before {content:'✓';font-size:15px;font-weight:800}
.result p {margin:0}
.related {display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}
.related a {display:inline-flex;align-items:center;min-height:36px;font-size:13px;font-weight:600;padding:6px 10px;border:1px solid var(--area-line);border-radius:6px;text-decoration:none;background:var(--area-wash);color:var(--area-dark)}
.related a:hover {background:var(--area);border-color:var(--area);color:white;box-shadow:0 3px 8px #17263824;transform:translateY(-1px)}
.related a:active {transform:none;box-shadow:inset 0 1px 3px #17263855}
.sources {margin-top:22px;font-size:13px;color:#43556c;border-top:1px dashed #a7b7cb;padding-top:13px}
.sources summary {cursor:pointer;padding:8px;border-radius:6px;color:#344a65}
.sources summary:hover {background:#e4ebf5;color:#142944}
.sources ul {padding-left:18px}
.anchor-alias {scroll-margin-top:25px}
.empty {padding:25px;text-align:center;background:white;border:1px dashed #7f95b2;border-radius:10px;color:#344a65}
.journey {padding:28px;background:white;border:1px solid var(--area-line);border-top:5px solid var(--area);border-radius:13px;margin:28px 0;scroll-margin-top:25px;box-shadow:0 3px 8px #1726380d}
.journey>h2 {color:var(--area-dark)}
.journey .when {color:#43556c;font-size:15px;border-bottom:1px solid #cbd6e5;padding-bottom:17px;margin-bottom:20px}
.stages {list-style:none;padding:0;counter-reset:stage;margin:27px 0}
.stage {counter-increment:stage;position:relative;margin:0!important;padding:0 0 27px 48px;border-left:2px solid var(--area-line);margin-left:17px!important}
.stage:last-child {padding-bottom:0;border-color:transparent}
.stage:before {content:counter(stage);position:absolute;left:-18px;top:0;width:34px;height:34px;display:grid;place-items:center;background:var(--area);color:#fff;border:3px solid white;box-shadow:0 0 0 1px var(--area-line);border-radius:50%;font-size:13px;font-weight:800}
.stage h3 {font-size:1.08rem;color:#172638}
.stage p {margin:8px 0 10px;font-size:15px;max-width:78ch}
.stage a {display:inline-block;font-size:13px;font-weight:650;padding:5px 8px;border:1px solid var(--area-line);border-radius:5px;background:var(--area-wash);color:var(--area-dark);text-decoration:none}
.stage a:hover {background:var(--area);color:white;border-color:var(--area);box-shadow:0 3px 8px #17263824}
.checkpoint {padding:17px 18px;border:1px solid #d6ad56;border-left:4px solid #92400e;background:#fffbeb;border-radius:8px;margin-top:18px;font-size:14px;color:#65360b}
.checkpoint strong {display:flex;align-items:center;gap:9px;margin-bottom:7px;color:#78350f}
.checkpoint strong:before {content:'!';width:19px;height:19px;display:grid;place-items:center;flex-shrink:0;border-radius:50%;background:#92400e;color:white;font-size:12px}
.flow-index {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.flow-index a {display:block;position:relative;padding:17px 36px 17px 17px;background:white;color:var(--area-dark);border:1px solid var(--area-line);border-left:5px solid var(--area);border-radius:8px;text-decoration:none;font-size:14px;font-weight:750;box-shadow:0 2px 4px #1726380a}
.flow-index a:after {content:'→';position:absolute;right:14px;top:50%;transform:translateY(-50%)}
.flow-index a:hover {background:var(--area-wash);border-color:var(--area);box-shadow:0 5px 12px #1726381c;transform:translateY(-2px)}
.flow-index a:active {transform:none;background:var(--area-wash);box-shadow:inset 0 1px 3px #17263833}
.directory {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.directory .panel {margin:0;border-top:4px solid var(--area)}
.directory h3 {color:var(--area-dark);margin-bottom:8px}
.directory ul {font-size:14px}
.directory a {overflow-wrap:anywhere;color:var(--area-dark)}
.directory a:hover {background:var(--area-wash);color:var(--area-dark)}
.trace {margin-top:44px;border:1px solid #a6b8d1;border-radius:10px;background:#f3f6fb;padding:20px}
.trace>summary {cursor:pointer;font-weight:700;padding:9px;border-radius:7px;color:#263e5e}
.trace>summary:hover {background:#dce6f5;color:#142944}
.trace table {margin-top:20px;background:white}
.trace h3 {margin-top:24px}
footer {margin-top:32px;font-size:13px;color:#43556c;border-top:1px solid #a8b9cf;padding-top:22px}
@media(max-width:1050px) {
  .shell {grid-template-columns:230px minmax(0,1fr)}
  .sidebar {padding:22px 14px}
  .main {padding:35px 25px}
  .workspace-grid {grid-template-columns:1fr}
  .workspace {padding:16px}
  .workspace p {font-size:15px}
}
@media(max-width:740px) {
  .shell {display:block}
  .sidebar {position:static;height:auto;padding:18px 20px}
  .sidebar .brand {font-size:16px}
  .sidebar>p {margin-bottom:0}
  .sidebar nav {padding-top:8px}
  .sidebar nav a {min-height:40px}
  .main {padding:28px 18px 45px}
  .toolbar {grid-template-columns:1fr;padding:16px}
  .counter {margin-left:0;flex-basis:100%}
  .module>summary {padding:18px;padding-right:56px}
  .module>summary:after {right:13px;top:19px;width:27px;height:27px}
  .module-body {padding:0 18px 22px}
  .module-body ol {padding-left:35px;padding-right:15px}
  .journey,.panel {padding:20px}
  .flow-index,.directory {grid-template-columns:1fr}
  h2 {font-size:1.5rem}
  .group-head {padding:14px 13px;gap:12px;align-items:flex-start}
  .group-head h2 {font-size:1.4rem}
  .area-number {flex-basis:33px;width:33px;height:33px;font-size:12px}
  .stage {padding-left:31px}
  .table-wrap {max-width:100%}
  table {min-width:520px}
  code {word-break:break-word}
  .meta {gap:6px}
  .trace {padding:14px}
}
@media(prefers-reduced-motion:reduce) {
  html {scroll-behavior:auto}
  a,button,summary,input,select {transition:none!important}
  a:hover,button:hover {transform:none!important}
}
@media print {
  @page {size:A4;margin:15mm}
  body {font-size:10pt;line-height:1.5;background:white;color:black}
  .shell {display:block}
  .sidebar,.skip,.toolbar,.no-print,#empty {display:none!important}
  .main {padding:0;max-width:none}
  [hidden] {display:block!important}
  .module,.journey,.panel {box-shadow:none;break-inside:auto;padding:12px;margin:12px 0}
  .module>summary {padding:0 0 10px}
  .module>summary:after {display:none}
  .module-body {padding:0;border-top:1px solid #ccc}
  .module:not([open])>:not(summary),details::details-content {display:block!important;content-visibility:visible!important}
  .sources {font-size:8pt}
  .sources:not([open])>:not(summary) {display:block!important}
  .workspace-grid {grid-template-columns:repeat(3,1fr)}
  .workspace {padding:10px;box-shadow:none}
  .tag {font-size:8pt}
  .directory,.flow-index {display:block}
  .table-wrap {overflow:visible}
  table {min-width:0!important;font-size:8pt}
  th,td {padding:6px}
  th {background:#e5eaf0;color:black}
  h1 {font-size:27pt}
  h2 {font-size:18pt;break-after:avoid}
  h3,h4,summary {break-after:avoid}
  a {color:black}
  .section {margin-top:24px}
  .group-head {padding:10px;box-shadow:none}
  .area-number {flex-basis:30px;width:30px;height:30px;font-size:10pt}
  .related a,.stage a {min-height:0;padding:3px 6px}
  .result,.notice,.checkpoint {background:#f6f6f6}
  .trace table {table-layout:fixed}
  .trace td,.trace th {overflow-wrap:anywhere}
  .stage {padding-bottom:16px}
  .stage:before,.area-number {print-color-adjust:exact;-webkit-print-color-adjust:exact}
  .trace {break-before:page}
}
`;
