import { mmuStartContent } from './mmu-view.js';
import { bindSimulationMenu, simulationMenu } from './navigation.js';
import {
  X64_ADDRESS_MASK, X64_CR3, X64_ENTRY_COUNT,
  hexX64, parseX64Address, planX64Translation, readX64Entry, x64Examples,
  x64LevelNames, x64PageTables,
} from './x64.js';

const $ = selector => document.querySelector(selector);
const accessNames = { read: 'lectura', write: 'escritura', execute: 'ejecución' };
const modeNames = { user: 'usuario', supervisor: 'supervisor' };
const faultNames = {
  'not-present': 'entrada no presente',
  'reserved-bit': 'bit reservado',
  'large-page': 'página grande válida',
  'user-protection': 'protección de usuario',
  'write-protection': 'protección de escritura',
  'execute-protection': 'protección de ejecución',
  noncanonical: 'dirección no canónica',
};
let trace = null;
let step = 0;
let timer = null;

document.title = 'Paginación x86-64 · Página a página';
$('#app').classList.add('riscv-app', 'x64-app');
$('#app').innerHTML = `
  <header class="site-header"><div class="cloud cloud-one"></div><div class="cloud cloud-two"></div><div class="header-inner">
    <a class="brand" href="./" aria-label="Página a página, inicio"><span class="brand-icon" aria-hidden="true">▥</span><span>Página a página<small>LABORATORIO DE MEMORIA</small></span></a>
    <nav aria-label="Navegación principal">${simulationMenu('x64')}<button data-rv-dialog="guide" aria-haspopup="dialog">Guía rápida</button><button data-rv-dialog="theory" aria-haspopup="dialog">Fundamento teórico</button><button data-rv-dialog="about" aria-haspopup="dialog">Sobre el proyecto</button></nav>
    <span class="faculty">FIUBA <span>/</span> Sistemas Operativos</span>
  </div></header>
  <main class="rv-main">
    <section class="intro"><div><div class="eyebrow">CUATRO NIVELES DE TABLAS</div><h1>x86-64 <span>paso a paso.</span></h1><p>Seguí cómo la MMU recorre cuatro páginas de tablas desde <code>CR3</code> hasta un marco físico.</p></div><div class="architecture"><div><strong>Dirección lineal · 64 bits</strong><span>4 niveles · índices 9/9/9/9 · offset 12</span></div><span class="page-tag">4 KiB<small>PÁGINA</small></span></div></section>
    <section class="input-panel" aria-label="Configuración de la traducción x86-64"><form id="rv-form" novalidate>
      <div class="address-field"><label for="rv-address">Tu dirección lineal <span>HEX · 64 BITS</span></label><div class="input-wrap"><input id="rv-address" value="0x0000000000403010" maxlength="18" spellcheck="false" autocomplete="off" aria-describedby="rv-error"/><button class="button yellow" type="submit">Traducir →</button></div></div>
      <div class="field"><label for="rv-example">Preparar un ejemplo</label><select id="rv-example">${x64Examples.map((example, index) => `<option value="${index}">${example.name}</option>`).join('')}<option value="custom" hidden>Acceso personalizado</option></select></div>
      <div class="field"><label for="rv-access">Operación</label><select id="rv-access"><option value="read">Lectura</option><option value="write">Escritura</option><option value="execute">Ejecución</option></select></div>
      <div class="field"><label for="rv-mode">Modo</label><select id="rv-mode"><option value="user">Usuario</option><option value="supervisor">Supervisor</option></select></div>
    </form><p id="rv-error" class="error" role="alert" hidden></p></section>
    <section class="simulation rv-simulation" aria-label="Recorrido de paginación x86-64">
      <div class="simulation-heading"><div><span class="live-dot"></span><h2>El recorrido de tablas x86-64</h2></div><span class="scene-label">MMU → cuatro tablas → RAM</span></div>
      <ol id="rv-steps" class="stepper" aria-label="Pasos de la traducción x86-64"></ol>
      <div id="rv-scene"></div>
      <div id="rv-explanation" class="explanation" aria-live="polite" aria-atomic="true" title="Ctrl + clic para ampliar la explicación"><span id="rv-step-number" class="explanation-number"></span><div class="rv-explanation-copy"><div id="rv-eyebrow" class="explanation-eyebrow" hidden></div><div class="rv-explanation-head"><h3 id="rv-title"></h3><button id="rv-zoom-open" class="rv-zoom-open" type="button" aria-label="Ampliar explicación" title="Ampliar explicación (Ctrl + clic)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 6 6"/></svg></button></div><p id="rv-text"></p><div id="rv-operations" class="rv-operation-list" hidden></div></div></div>
      <div class="controls rv-controls"><button id="rv-restart" class="text-button">↺ Reiniciar</button><div class="playback"><button id="rv-play" class="text-button">▷ Reproducir</button><select id="rv-speed" aria-label="Velocidad de reproducción"><option value="4000">1×</option><option value="2000">2×</option><option value="6500">0,5×</option></select></div><div class="step-controls"><span id="rv-counter"></span><button id="rv-previous" class="button previous">← Anterior</button><button id="rv-next" class="button yellow">Siguiente →</button></div></div>
    </section>
    <div class="below-scene rv-note"><p><strong>Modelo fijo de 4 KiB.</strong> Las tablas ausentes no se crean: P=0 genera #PF. Una dirección no canónica genera #GP antes del recorrido.</p></div>
    <footer><span><strong>FIUBA</strong> / Ingeniería en Informática · Sistemas Operativos</span><span>Modelo: IA-32e, cuatro niveles, sin LA57 ni páginas grandes.</span></footer>
  </main>
  <dialog id="rv-dialog"><div class="dialog-top"><span class="eyebrow">PÁGINA A PÁGINA · X86-64</span><button id="rv-close-dialog" class="icon-button" aria-label="Cerrar">✕</button></div><div id="rv-dialog-content"></div></dialog>
  <dialog id="rv-zoom" class="rv-zoom-dialog" aria-labelledby="rv-zoom-title"><div class="rv-zoom-top"><span id="rv-zoom-step"></span><button id="rv-zoom-close" class="icon-button" type="button" aria-label="Cerrar ampliación">✕</button></div><h2 id="rv-zoom-title"></h2><p id="rv-zoom-text"></p><div id="rv-zoom-operations" class="rv-operation-list" hidden></div><small>Esc para cerrar</small></dialog>
`;

function simpleExample() { return $('#rv-example').value === '0'; }

function mmuCard(current) {
  const active = current.key === 'start';
  return `<article class="cpu-node mmu-start-card rv-mmu-card ${active ? 'rv-component-active component-enter' : ''}" aria-label="MMU y registro CR3">${mmuStartContent({ register: 'CR3', value: hexX64(X64_CR3), footnote: 'Base física de la tabla raíz · 0x0000000010000000', focus: active, registerClass: 'rv-satp-box' })}</article>`;
}

function addressStrip(current) {
  if (current.key === 'start' || current.key === 'canonical') return '';
  const bits = trace.address.toString(2).padStart(64, '0');
  const groups = [
    { key: 'pml4', name: x64LevelNames[0], value: trace.pml4, bits: bits.slice(16, 25), tone: 'blue' },
    { key: 'pdpt', name: x64LevelNames[1], value: trace.pdpt, bits: bits.slice(25, 34), tone: 'green' },
    { key: 'pd', name: x64LevelNames[2], value: trace.pd, bits: bits.slice(34, 43), tone: 'purple' },
    { key: 'pt', name: x64LevelNames[3], value: trace.pt, bits: bits.slice(43, 52), tone: 'orange' },
    { key: 'offset', name: 'Offset', value: hexX64(trace.offset, 3), bits: bits.slice(52), tone: 'blue' },
  ];
  const sign = (trace.address >> 47n) & 1n;
  return `<div class="address-breakdown rv-address-strip ${current.key === 'split' ? 'rv-component-active component-enter' : ''}" aria-label="Dirección lineal canónica dividida en cuatro índices y offset"><div class="address-source"><span>DIRECCIÓN LINEAL · bits 63:48 = ${sign ? '1' : '0'}</span><strong>${hexX64(trace.address)}</strong></div><span class="split-arrow" aria-hidden="true">=</span>${groups.map(group => `<div class="bit-segment ${group.tone} ${current.name?.toLowerCase() === group.key || current.phase === 'offset' && group.key === 'offset' ? 'rv-bit-active' : ''}"><span>${group.name} <small>${group.key === 'offset' ? 12 : 9} bits</small></span><strong>${group.value}</strong><code data-x64-bits="${group.key}">${group.bits}</code></div>`).join('')}</div>`;
}

function tableRows(read, simplified) {
  const known = [...(x64PageTables.get(read.tableBase)?.keys() ?? []), read.index];
  const candidates = new Set([0, X64_ENTRY_COUNT - 1, ...known]);
  if (read.index > 0) candidates.add(read.index - 1);
  if (read.index < X64_ENTRY_COUNT - 1) candidates.add(read.index + 1);
  let previous = -1;
  return [...candidates].sort((a, b) => a - b).map(index => {
    const gap = index - previous > 1 ? '<tr class="rv-ellipsis"><td colspan="2">⋮</td></tr>' : '';
    const value = readX64Entry(read.tableBase, index);
    const base = value & X64_ADDRESS_MASK;
    previous = index;
    return `${gap}<tr data-x64-index="${index}" class="${index === read.index ? 'rv-row-selected' : ''}"><td>${index === read.index ? '<span class="tlb-row-pointer">▸</span>' : ''}${index}</td>${simplified ? `<td>${value ? hexX64(base) : '—'}</td>` : `<td>${hexX64(value)}</td>`}</tr>`;
  }).join('');
}

function tableCard(read, current, simplified) {
  const active = current.read === read || current.key === 'permissions' && read.level === 3;
  const tone = ['blue', 'green', 'purple', 'orange'][read.level];
  const columns = simplified ? '<th>Índice</th><th>Destino físico</th>' : '<th>Índice</th><th>Entrada de 64 bits</th>';
  const destination = read.nextBase === null ? 'P=0 · sin destino' : read.fault?.kind === 'large-page' ? 'página grande válida · fuera del modelo' : read.fault ? `base codificada ${hexX64(read.nextBase)} · recorrido detenido` : `${read.level === 3 ? 'marco' : 'tabla siguiente'} ${hexX64(read.nextBase)}`;
  return `<article class="rv-table-card rv-${tone} ${active ? 'rv-component-active component-enter component-loading' : ''}" aria-label="${x64LevelNames[read.level]}"><div class="rv-card-heading"><h3>${x64LevelNames[read.level]}<small>base ${hexX64(read.tableBase)}</small></h3><span>512 entradas</span></div><table><thead><tr>${columns}</tr></thead><tbody>${tableRows(read, simplified)}</tbody></table><div class="rv-table-read"><span>Entrada [${read.index}] @</span><code>${hexX64(read.entryAddress)}</code><small>${destination}</small></div></article>`;
}

function physicalCard() {
  const percent = Number(trace.offset) / 4095 * 100;
  return `<article class="rv-physical-card rv-component-active component-enter" aria-label="Espacio de direcciones físicas"><div class="rv-card-heading"><h3>Address Space<small>Memoria física · modelo de 52 bits</small></h3><span>RAM</span></div><div class="rv-physical-space"><div class="rv-memory-limit"><span>Primera dirección</span><code>0x0000000000000000</code></div><div class="rv-memory-gap">⋮</div><div class="rv-xv6-ram"><span>Marco físico del ejemplo</span><div class="rv-frame"><small>4 KiB</small><strong>${hexX64(trace.frame)}</strong><div class="rv-byte-track"><i style="left:${percent}%" aria-hidden="true"></i></div></div></div><div class="rv-memory-gap">⋮</div><div class="rv-memory-limit"><span>Máximo del modelo</span><code>0x000FFFFFFFFFFFFF</code></div></div><div class="rv-physical-result"><div><span>Dirección física</span><small>Marco + offset</small></div><strong id="rv-physical">${hexX64(trace.physical)}</strong></div></article>`;
}

function operationItems(current) {
  if (!trace?.detailed || !current) return [];
  if (current.key === 'start') return [{ label: '1 · Aislar base de la tabla raíz', expression: `${hexX64(trace.cr3)} & 0x000FFFFFFFFFF000`, result: hexX64(trace.root) }];
  if (current.key === 'split' && !trace.expanded) return [
    ...[[x64LevelNames[0], 39, trace.pml4], [x64LevelNames[1], 30, trace.pdpt], [x64LevelNames[2], 21, trace.pd], [x64LevelNames[3], 12, trace.pt]].map(([name, shift, index]) => ({ label: name, expression: `(VA >> ${shift}) & 0x1FF`, result: `${index} = ${BigInt(index).toString(2).padStart(9, '0')}₂` })),
    { label: 'Offset', expression: 'VA & 0xFFF', result: hexX64(trace.offset, 3) },
  ];
  if (current.phase === 'index') return [
    { label: '1 · Corrimiento', expression: `${hexX64(trace.address)} >> ${current.shift}`, result: hexX64(current.shifted) },
    { label: '2 · Máscara de 9 bits', expression: `${hexX64(current.shifted)} & 0x1FF`, result: `${hexX64(BigInt(current.index), 3)} = ${current.index}` },
  ];
  if (current.phase === 'offset') return [{ label: 'Conservar 12 bits', expression: `${hexX64(trace.address)} & 0xFFF`, result: hexX64(trace.offset, 3) }];
  if (current.phase === 'lookup') {
    const read = current.read;
    const displacement = BigInt(read.index) * 8n;
    return [
      { label: '1 · Desplazamiento', expression: `${read.index} × 8`, result: hexX64(displacement, 3) },
      { label: '2 · Dirección física de la entrada', expression: `${hexX64(read.tableBase)} + ${hexX64(displacement, 3)}`, result: hexX64(read.entryAddress) },
      { label: '3 · Lectura física', expression: `Mem[${hexX64(read.entryAddress)}]`, result: hexX64(read.entry) },
    ];
  }
  if (current.phase === 'flags') {
    const read = current.read;
    const flags = read.decoded.flags;
    return [
      { label: '1 · NX · bit 63', expression: `${hexX64(read.entry)} & 0x8000000000000000`, result: flags.NX ? '0x8000000000000000 → NX=1' : '0 → NX=0' },
      { label: '2 · Bits bajos [11:0]', expression: `${hexX64(read.entry)} & 0xFFF`, result: `${hexX64(read.decoded.lowBits, 3)} · P=${+flags.P} R/W=${+flags.RW} U/S=${+flags.US} ${read.level === 3 ? 'PAT' : read.level === 0 ? 'reservado' : 'PS'}=${+flags.B7}` },
      { label: '3 · Decisión', expression: `${modeNames[trace.mode]} · ${accessNames[trace.access]}`, result: current.fault ? `${current.fault.exception ?? 'Fuera del modelo'} · ${faultNames[current.fault.kind] ?? 'fallo no clasificado'}` : 'Continuar' },
    ];
  }
  if (current.phase === 'base') return [{ label: current.read.level === 3 ? 'Marco físico' : 'Base de tabla siguiente', expression: `${hexX64(current.read.entry)} & 0x000FFFFFFFFFF000`, result: hexX64(current.read.nextBase) }];
  if (current.key === 'permissions') return [
    { label: 'Presencia', expression: 'P(nivel 4) & P(nivel 3) & P(nivel 2) & P(nivel 1)', result: '1 en los cuatro niveles' },
    { label: 'Usuario', expression: 'U/S acumulado', result: trace.mode === 'user' ? '1 en los cuatro niveles' : 'supervisor' },
    { label: 'Operación', expression: trace.access === 'write' ? 'R/W acumulado' : trace.access === 'execute' ? 'NX acumulado' : 'lectura con P=1', result: 'autorizada' },
  ];
  if (current.key === 'physical') return [
    { label: 'Marco', expression: 'Entrada final & 0x000FFFFFFFFFF000', result: hexX64(trace.frame) },
    { label: 'Offset', expression: 'VA & 0xFFF', result: hexX64(trace.offset, 3) },
    { label: 'Dirección física', expression: `${hexX64(trace.frame)} + ${hexX64(trace.offset, 3)}`, result: hexX64(trace.physical) },
  ];
  return [];
}

function operationMarkup(items) { return items.map(item => `<div><span>${item.label}</span><code>${item.expression}</code><strong>= ${item.result}</strong></div>`).join(''); }

function render() {
  const current = trace?.steps[step];
  $('#rv-steps').classList.toggle('rv-steps-detailed', Boolean(trace?.detailed));
  $('#rv-steps').classList.toggle('rv-steps-expanded', Boolean(trace?.expanded));
  $('#rv-steps').innerHTML = trace ? trace.steps.map((item, index) => `<li><button class="step-button ${index === step ? 'current' : index < step ? 'complete' : ''}" data-rv-step="${index}" data-rv-key="${item.key}" ${index === step ? 'aria-current="step"' : ''}><span class="step-number">${index + 1}</span><span>${item.label}</span></button></li>`).join('') : '<li>Ingresá una dirección válida para comenzar.</li>';
  if (trace?.expanded) {
    const selected = $('#rv-steps').querySelector('[aria-current="step"]');
    $('#rv-steps').scrollLeft = selected.getBoundingClientRect().left - $('#rv-steps').getBoundingClientRect().left + $('#rv-steps').scrollLeft - ($('#rv-steps').clientWidth - selected.offsetWidth) / 2;
  }
  if (!current) $('#rv-scene').innerHTML = '<div class="empty-scene"><strong>Sin traducción activa</strong><p>Corregí la dirección y presioná Traducir.</p></div>';
  else {
    const revealed = new Set(trace.steps.slice(0, step + 1).map(item => item.key));
    const cards = [mmuCard(current)];
    for (const read of trace.reads) if (revealed.has(read.key)) cards.push(tableCard(read, current, simpleExample()));
    if (current.key === 'physical') cards.push(physicalCard());
    const path = cards.map((card, index) => `${index ? '<span class="rv-path-arrow" aria-hidden="true">→</span>' : ''}${card}`).join('');
    $('#rv-scene').innerHTML = `${addressStrip(current)}<div class="rv-path rv-path-count-${cards.length}">${path}</div>`;
  }
  $('#rv-explanation').classList.toggle('fault', Boolean(current?.fault));
  $('#rv-step-number').textContent = current?.fault ? '!' : current ? step + 1 : '—';
  $('#rv-eyebrow').hidden = !current?.fault;
  $('#rv-eyebrow').textContent = current?.fault ? current.fault.exception ? `EXCEPCIÓN · ${current.fault.exception}` : 'VARIANTE FUERA DEL MODELO' : '';
  $('#rv-title').textContent = current?.title ?? 'Esperando una dirección válida.';
  $('#rv-text').textContent = current?.text ?? 'El recorrido anterior fue descartado.';
  $('#rv-zoom-open').disabled = !current;
  const operations = operationItems(current);
  $('#rv-explanation').classList.toggle('has-operations', operations.length > 0);
  $('#rv-operations').hidden = operations.length === 0;
  $('#rv-operations').innerHTML = operationMarkup(operations);
  $('#rv-counter').textContent = trace ? `Paso ${step + 1} de ${trace.steps.length}` : 'Sin traducción';
  $('#rv-previous').disabled = !trace || step === 0;
  $('#rv-next').disabled = !trace || step === trace.steps.length - 1;
  for (const selector of ['#rv-restart', '#rv-play', '#rv-speed']) $(selector).disabled = !trace;
  $('#rv-play').textContent = timer ? 'Ⅱ Pausar' : '▷ Reproducir';
}

function stop() { clearInterval(timer); timer = null; }
function invalidate() { stop(); trace = null; step = 0; render(); }
function start() {
  stop();
  try {
    trace = planX64Translation(parseX64Address($('#rv-address').value), { access: $('#rv-access').value, mode: $('#rv-mode').value, detailed: !simpleExample(), expanded: $('#rv-example').value === '1' });
    $('#rv-address').value = hexX64(trace.address);
    $('#rv-error').hidden = true;
    $('#rv-address').removeAttribute('aria-invalid');
    step = 0;
    render();
  } catch (error) {
    $('#rv-error').textContent = error.message;
    $('#rv-error').hidden = false;
    $('#rv-address').setAttribute('aria-invalid', 'true');
    invalidate();
    $('#rv-address').focus();
  }
}
function move(index) { if (!trace) return; step = Math.min(trace.steps.length - 1, Math.max(0, index)); if (step === trace.steps.length - 1) stop(); render(); }
function play() { if (!trace) return; if (timer) { stop(); render(); return; } if (step === trace.steps.length - 1) step = 0; timer = setInterval(() => move(step + 1), Number($('#rv-speed').value)); render(); }
function openZoom() {
  const current = trace?.steps[step];
  if (!current || $('#rv-zoom').open) return;
  stop(); render();
  const items = operationItems(current);
  $('#rv-zoom-step').textContent = current.fault ? `${current.fault.exception ? 'EXCEPCIÓN' : 'VARIANTE'} · PASO ${step + 1}` : `PASO ${step + 1} DE ${trace.steps.length}`;
  $('#rv-zoom-title').textContent = current.title;
  $('#rv-zoom-text').textContent = current.text;
  $('#rv-zoom-operations').hidden = items.length === 0;
  $('#rv-zoom-operations').innerHTML = operationMarkup(items);
  $('#rv-zoom').showModal();
}

$('#rv-form').addEventListener('submit', event => { event.preventDefault(); start(); });
$('#rv-address').addEventListener('input', () => { $('#rv-error').hidden = true; $('#rv-address').removeAttribute('aria-invalid'); $('#rv-example').value = 'custom'; invalidate(); });
for (const selector of ['#rv-access', '#rv-mode']) $(selector).addEventListener('change', () => { $('#rv-example').value = 'custom'; start(); });
$('#rv-example').addEventListener('change', () => { const example = x64Examples[Number($('#rv-example').value)]; if (!example) return; $('#rv-address').value = example.address; $('#rv-access').value = example.access; $('#rv-mode').value = example.mode; start(); });
$('#rv-next').addEventListener('click', () => { stop(); move(step + 1); });
$('#rv-previous').addEventListener('click', () => { stop(); move(step - 1); });
$('#rv-restart').addEventListener('click', () => { stop(); move(0); });
$('#rv-play').addEventListener('click', play);
$('#rv-speed').addEventListener('change', () => { if (timer) { stop(); play(); } });
$('#rv-steps').addEventListener('click', event => { const button = event.target.closest('[data-rv-step]'); if (button) { stop(); move(Number(button.dataset.rvStep)); } });
$('#rv-explanation').addEventListener('click', event => { if (event.button === 0 && (event.ctrlKey || event.metaKey)) { event.preventDefault(); openZoom(); } });
$('#rv-zoom-open').addEventListener('click', event => { event.stopPropagation(); openZoom(); });
$('#rv-zoom-close').addEventListener('click', () => $('#rv-zoom').close());
$('#rv-zoom').addEventListener('click', event => { if (event.target !== $('#rv-zoom')) return; const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); });

function theoryContent() {
  return `<article class="rv-theory-article">
    <header class="rv-theory-hero"><span class="eyebrow">X86-64 · IA-32E · 4 NIVELES</span><h2>De CR3 al byte físico</h2><p>La <strong>MMU recorre las tablas por hardware</strong>; el sistema operativo reserva memoria e instala las entradas. El recorrido mostrado supone que no hay una traducción aprovechable en la TLB.</p><div class="rv-responsibility-grid"><section><span>HARDWARE</span><strong>MMU</strong><p>Comprueba la dirección, lee cuatro entradas, acumula permisos y forma la dirección física o genera una excepción.</p></section><section><span>SOFTWARE</span><strong>Sistema operativo</strong><p>Prepara la tabla de mapa de páginas de nivel 4, la tabla de punteros a directorios de páginas, el directorio de páginas y la tabla de páginas; escribe CR3 y administra los fallos. El mapa aquí es sintético, no una captura de un SO.</p></section></div></header>
    <section class="rv-theory-section"><div class="rv-section-title"><span>1</span><div><h3>Dirección lineal canónica</h3><p>En este modo de cuatro niveles, LA57 está desactivado.</p></div></div><div class="rv-theory-diagram rv-wide-diagram"><div class="rv-va64 x64-va64"><span class="rv-sign"><b>63…48</b><strong>Extensión de signo</strong><small>16 bits · copian bit 47</small></span><span class="rv-vpn2"><b>47…39</b><strong>${x64LevelNames[0]}</strong><small>9 bits</small></span><span class="rv-vpn1"><b>38…30</b><strong>${x64LevelNames[1]}</strong><small>9 bits</small></span><span class="rv-vpn0"><b>29…21</b><strong>${x64LevelNames[2]}</strong><small>9 bits</small></span><span class="rv-page-offset"><b>20…12</b><strong>${x64LevelNames[3]}</strong><small>9 bits</small></span><span class="rv-sign"><b>11…0</b><strong>Offset</strong><small>12 bits</small></span></div></div><div class="rv-theory-note"><strong>La dirección no canónica no llega a la tabla raíz.</strong><p>Los bits 63:48 deben repetir el bit 47. Una referencia ordinaria no canónica provoca <code>#GP</code> antes de paginar; una referencia por SS puede provocar <code>#SS</code>. El laboratorio muestra accesos ordinarios, no accesos mediante SS.</p></div><div class="rv-nine-bit-grid"><div><span>Página de tabla</span><strong>4096 bytes</strong></div><b>÷</b><div><span>Entrada</span><strong>8 bytes</strong></div><b>=</b><div><span>Índices</span><strong>512 = 2<sup>9</sup></strong></div></div></section>
    <section class="rv-theory-section"><div class="rv-section-title"><span>2</span><div><h3>Bits de cada entrada</h3><p>La máscara separa base física y atributos.</p></div></div><div class="rv-pte-scroll"><div class="rv-pte-layout x64-pte-layout"><span class="rv-pte-rsw"><b>63</b><strong>NX</strong><small>no ejecutar</small></span><span class="rv-pte-reserved"><b>62…52</b><strong>Otros / reservados</strong><small>cero en el modelo</small></span><span class="rv-pte-ppn"><b>51…12</b><strong>Base física</strong><small>hasta 52 bits físicos</small></span><span class="rv-pte-flags"><b>11…0</b><strong>P · R/W · U/S…</strong><small>flags bajos</small></span></div></div><div class="rv-pte-operation-grid"><section><span>Índice</span><code>(VA &gt;&gt; desplazamiento) &amp; 0x1FF</code><p>Desplazamientos 39, 30, 21 y 12; cada resultado está entre 0 y 511.</p></section><section><span>Dirección de entrada</span><code>base + índice × 8</code><p>La MMU lee una entrada de 64 bits en esa dirección física.</p></section><section><span>Base siguiente o marco</span><code>entrada &amp; 0x000FFFFFFFFFF000</code><p>Conserva los bits 51:12 y descarta NX y los flags bajos.</p></section></div><p class="rv-caption">El bit 7 indica PS en las entradas de la tabla de punteros a directorios y del directorio de páginas; en la entrada final de 4 KiB indica PAT, y en la entrada de la tabla raíz está reservado. El límite de 52 bits es el máximo arquitectónico representado por estas entradas; una CPU concreta puede implementar menos bits físicos. Este mapa utiliza sólo direcciones físicas bajas.</p></section>
    <section class="rv-theory-section"><div class="rv-section-title"><span>3</span><div><h3>Cuatro lecturas físicas</h3><p>Ejemplo: VA <code>0x0000000000403010</code>.</p></div></div><ol class="rv-hardware-flow"><li><span>1</span><div><strong>CR3 y entrada [0] de la tabla de mapa de páginas de nivel 4</strong><p>CR3 entrega <code>0x10000000</code>. Se lee <code>Mem[0x10000000 + 0×8] = 0x10001007</code>; la siguiente tabla comienza en <code>0x10001000</code>.</p></div></li><li><span>2</span><div><strong>Entrada [0] de la tabla de punteros a directorios de páginas</strong><p><code>Mem[0x10001000 + 0×8] = 0x10002007</code>; el directorio de páginas comienza en <code>0x10002000</code>.</p></div></li><li><span>3</span><div><strong>Entrada [2] del directorio de páginas</strong><p><code>Mem[0x10002000 + 2×8] = Mem[0x10002010] = 0x10003007</code>; la tabla de páginas comienza en <code>0x10003000</code>.</p></div></li><li><span>4</span><div><strong>Entrada [3] de la tabla de páginas</strong><p><code>Mem[0x10003000 + 3×8] = Mem[0x10003018] = 0x800000002000A007</code>. NX=1, pero la lectura de usuario está permitida. El marco es <code>0x2000A000</code>.</p></div></li><li><span>5</span><div><strong>Dirección física</strong><p><code>0x2000A000 + (VA &amp; 0xFFF) = 0x2000A000 + 0x010 = 0x2000A010</code>.</p></div></li></ol></section>
    <section class="rv-theory-section"><div class="rv-section-title"><span>4</span><div><h3>Permisos y límites del ejercicio</h3><p>Una restricción en cualquier nivel basta para detener el acceso.</p></div></div><div class="rv-fault-rules"><strong>Reglas efectivas</strong><ul><li><code>P=0</code> en cualquier nivel: <code>#PF</code> y no se leen tablas posteriores.</li><li>Desde usuario, <code>U/S=1</code> en todas las entradas; para escribir, <code>R/W=1</code> en todas. Se supone <code>CR0.WP=1</code>.</li><li>Para ejecutar, <code>NX=0</code> en todas las entradas. Se supone <code>EFER.NXE=1</code>. No existe bit R separado para lectura.</li></ul></div><p class="rv-caption">Se muestran únicamente páginas base de 4 KiB. x86-64 también permite páginas de 2 MiB o 1 GiB mediante PS, y opcionalmente cinco niveles con LA57; esas variantes no forman parte de este recorrido. No se simulan TLB, PCID, A/D, SMEP/SMAP ni cambios de CR3.</p></section>
    <p class="rv-caption">Con PS=1, una entrada de la tabla de punteros a directorios que mapea 1 GiB requiere bits 29:13 en cero; una entrada del directorio que mapea 2 MiB requiere bits 20:13 en cero. De lo contrario hay #PF por bits reservados. Una página grande correctamente formada queda fuera de este ejercicio, sin presentarse como fallo de hardware.</p>
    <footer class="rv-theory-sources"><strong>Fuentes primarias</strong><a href="https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html" target="_blank" rel="noreferrer">Intel SDM · volumen 3, capítulo 4</a><a href="https://docs.amd.com/api/khub/documents/sD1_QL~h4Afq2_tvzxqqSQ/content" target="_blank" rel="noreferrer">AMD64 Programmer’s Manual · volumen 2, capítulo 5</a></footer>
  </article>`;
}

const help = {
  guide: `<h2>Tu primera traducción x86-64</h2><ol class="guide-list"><li><strong>Empezá por “Datos de usuario: lectura simple”.</strong> Muestra índice y destino en cada tabla sin desplegar la entrada cruda.</li><li><strong>Después probá la escritura detallada.</strong> Cada índice se obtiene con corrimiento y máscara; cada entrada se localiza con <code>base + índice × 8</code>.</li><li><strong>Seguí los cuatro niveles.</strong> Tabla de mapa de páginas de nivel 4 → tabla de punteros a directorios de páginas → directorio de páginas → tabla de páginas. Sólo aparecen las estructuras que la MMU ya consultó.</li><li><strong>Leé los flags antes de seguir.</strong> P, U/S, R/W y NX pueden detener el recorrido en cualquier nivel.</li><li><strong>Sumá el offset sólo al final.</strong> Los 12 bits bajos de la dirección no cambian.</li></ol><div class="guide-tip">Compará los ejemplos ausentes con la dirección no canónica: los primeros terminan en #PF durante el recorrido; la segunda termina en #GP antes de leer tablas.</div><p>Ampliá la explicación con <kbd>Ctrl</kbd> + clic o la lupa; cerrá con <kbd>Esc</kbd>. Atajos fuera de controles: <kbd>→</kbd> siguiente · <kbd>←</kbd> anterior · <kbd>Espacio</kbd> reproducir o pausar.</p>`,
  theory: theoryContent(),
  about: `<h2>Cinco formas de traducir.</h2><p>Laboratorio educativo independiente para Sistemas Operativos, Ingeniería en Informática, FIUBA. Sin afiliación institucional.</p><p>Paginación x86 de 32 bits, TLB, Segmentación, RISC-V/xv6 y x86-64 son simulaciones independientes con modelos y ayudas propios.</p>`,
};
document.querySelectorAll('[data-rv-dialog]').forEach(button => button.addEventListener('click', () => { stop(); render(); $('#rv-dialog-content').innerHTML = help[button.dataset.rvDialog]; $('#rv-dialog').setAttribute('aria-label', button.textContent.trim()); $('#rv-dialog').classList.toggle('rv-theory-dialog', button.dataset.rvDialog === 'theory'); $('#rv-dialog').showModal(); $('#rv-dialog').scrollTop = 0; }));
$('#rv-close-dialog').addEventListener('click', () => $('#rv-dialog').close());
$('#rv-dialog').addEventListener('click', event => { if (event.target !== $('#rv-dialog')) return; const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); });
document.addEventListener('keydown', event => { if (!trace || $('#rv-dialog').open || $('#rv-zoom').open || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(document.activeElement.tagName) || event.ctrlKey || event.metaKey || event.altKey) return; if (event.key === 'ArrowRight') { event.preventDefault(); stop(); move(step + 1); } if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); move(step - 1); } if (event.code === 'Space') { event.preventDefault(); play(); } });
window.addEventListener('pagehide', stop);
bindSimulationMenu(stop);
start();
