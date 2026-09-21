import { CR3, PAGE_SIZE, hex, memory, parseAddress } from './memory.js';
import { createTlb, planTlbTranslation, preloadTlb } from './tlb.js';
import { simulationMenu, bindSimulationMenu } from './navigation.js';

const $ = selector => document.querySelector(selector);
let cache = createTlb();
let trace = null;
let step = 0;
let committed = false;
let timer = null;
const scenarios = [
  { name: 'Miss: TLB vacía', address: '0x00403010', seed: [], access: 'read' },
  { name: 'Hit: traducción guardada', address: '0x00403010', seed: [0x00403010], access: 'read' },
  { name: 'Otro byte, misma página', address: '0x00403FFF', seed: [0x00403010], access: 'read' },
  { name: 'Miss: página no presente', address: '0x00405010', seed: [], access: 'read' },
  { name: 'Hit: escritura prohibida', address: '0x00404020', seed: [0x00404020], access: 'write' },
  { name: 'Miss: escritura prohibida', address: '0x00404020', seed: [], access: 'write' },
  { name: 'Hit: solo supervisor', address: '0xC0000010', seed: [0xC0000010], access: 'read' },
  { name: 'TLB llena: reemplazo FIFO', address: '0x00403010', seed: [0, 0x1000, 0x00400000, 0x00401000], access: 'read' },
  { name: 'El último byte', address: '0xFFFFFFFF', seed: [], access: 'read' },
];

function nearbyRows(index) {
  const nearby = index === 1023
    ? [index]
    : Array.from({ length: 3 }, (_, offset) => index + offset - 1).filter(row => row >= 0 && row <= 1023);
  const rows = [...new Set([0, ...nearby, 1023])].sort((a, b) => a - b);
  const output = [];
  rows.forEach((row, position) => {
    if (position && row - rows[position - 1] > 1) output.push(null);
    output.push(row);
  });
  return output;
}

function levelRows(index, entries, { selected = false, reference = false } = {}) {
  const rows = nearbyRows(index);
  const finalGap = rows.lastIndexOf(null);
  return rows.map((row, position) => {
    if (row === null) return `<tr class="tlb-level-ellipsis${position === finalGap ? ' tlb-level-ellipsis-to-end' : ''}" aria-hidden="true"><td>⋮</td><td>⋮</td><td></td></tr>`;
    const entry = entries?.get(row) ?? 0;
    const isTarget = row === index;
    const state = isTarget && selected ? 'tlb-level-selected' : isTarget && reference ? 'tlb-level-reference' : '';
    const marker = isTarget && selected ? '<span class="tlb-row-pointer">▸</span>' : '';
    const status = isTarget && selected ? (entry & 1 ? '✓' : '!') : '';
    return `<tr class="${state}" data-index="${row}"><td>${marker}${row}</td><td>${hex(entry)}</td><td>${status}</td></tr>`;
  }).join('');
}
document.title = 'Paginación con TLB · Página a página';
$('#app').classList.add('tlb-app');
$('#app').innerHTML = `
  <header class="site-header"><div class="cloud cloud-one"></div><div class="cloud cloud-two"></div><div class="header-inner">
    <a class="brand" href="./" aria-label="Página a página, inicio"><span class="brand-icon" aria-hidden="true">▤</span><span>Página a página<small>LABORATORIO DE MEMORIA</small></span></a>
    <nav aria-label="Navegación principal">${simulationMenu('tlb')}<button data-dialog="guide" aria-haspopup="dialog">Guía rápida</button><button data-dialog="theory" aria-haspopup="dialog">Fundamento teórico</button><button data-dialog="about" aria-haspopup="dialog">Sobre el proyecto</button></nav>
    <span class="faculty">FIUBA <span>/</span> Sistemas Operativos</span>
  </div></header>
  <main class="tlb-main">
    <section class="intro"><div><div class="eyebrow">UN ATAJO QUE RECUERDA</div><h1>Paginación <span>con TLB.</span></h1><p>La misma dirección, dos caminos. Consultá, compará y seguí el byte.</p></div><div class="architecture"><div><strong>x86 · páginas de 4 KiB</strong><span>TLB didáctica · 4 entradas · FIFO</span></div></div></section>
    <section class="input-panel" aria-label="Configuración de la traducción con TLB"><form id="tlb-form" novalidate>
      <div class="address-field"><label for="tlb-address">Tu dirección virtual <span>HEX</span></label><div class="input-wrap"><input id="tlb-address" value="0x00403010" maxlength="32" spellcheck="false" autocomplete="off" aria-describedby="tlb-error"/><button class="button yellow" type="submit">Traducir →</button></div></div>
      <div class="field"><label for="tlb-example">Preparar un ejemplo</label><select id="tlb-example">${scenarios.map((item, index) => `<option value="${index}">${item.name}</option>`).join('')}<option value="custom" hidden>Acceso personalizado</option></select></div>
      <div class="field"><label for="tlb-access">Tipo de acceso</label><select id="tlb-access"><option value="read">Lectura</option><option value="write">Escritura</option></select></div>
      <div class="field"><label for="tlb-mode">Modo</label><select id="tlb-mode"><option value="user">Usuario</option><option value="supervisor">Supervisor</option></select></div>
    </form><p id="tlb-error" class="error" role="alert" hidden></p></section>
    <section class="simulation tlb-simulation" aria-label="Recorrido con TLB">
      <div class="simulation-heading"><div><span class="live-dot"></span><h2>La ruta de la traducción</h2></div><span class="scene-label">MMU → TLB → RAM</span></div>
      <ol id="tlb-steps" class="stepper" aria-label="Pasos de la traducción con TLB"></ol>
      <div id="tlb-scene"></div>
      <div id="tlb-explanation" class="explanation" aria-live="polite" aria-atomic="true"><span id="tlb-step-number" class="explanation-number"></span><div><div id="tlb-eyebrow" class="explanation-eyebrow"></div><h3 id="tlb-title"></h3><p id="tlb-text"></p></div></div>
      <div class="controls tlb-controls"><button id="tlb-restart" class="text-button">↺ Ver de nuevo</button><div class="playback"><button id="tlb-play" class="text-button">▷ Reproducir</button><select id="tlb-speed" aria-label="Velocidad de reproducción"><option value="4000">1×</option><option value="2000">2×</option><option value="6500">0,5×</option></select></div><div class="step-controls"><span id="tlb-counter"></span><button id="tlb-previous" class="button previous">← Anterior</button><button id="tlb-next" class="button yellow">Siguiente →</button></div></div>
    </section>
    <div class="below-scene tlb-tools"><p id="tlb-cache-note">Cada ejemplo prepara su TLB. Traducir conserva los accesos terminados.</p><div><button id="tlb-repeat" class="text-button">Repetir acceso</button><button id="tlb-clear" class="text-button">Vaciar TLB</button></div></div>
    <footer><span><strong>FIUBA</strong> / Ingeniería en Informática · Sistemas Operativos</span><span>Un miss no es un page fault.</span></footer>
  </main>
  <dialog id="tlb-dialog"><div class="dialog-top"><span class="eyebrow">PÁGINA A PÁGINA · TLB</span><button id="tlb-close-dialog" class="icon-button" aria-label="Cerrar">✕</button></div><div id="tlb-dialog-content"></div></dialog>
`;

function mmuCard(current) {
  return `<article class="tlb-card tlb-mmu-card ${current?.key === 'start' ? 'tlb-component-active component-enter' : ''}" aria-label="MMU y registro CR3"><div class="tlb-mmu-chip" role="img" aria-label="Unidad de gestión de memoria"><i></i><strong>MMU</strong><i></i></div><h3>Unidad de gestión de memoria</h3><p>La traducción empieza acá.</p><div class="cr3-box"><span>CR3</span><code>${hex(CR3)}</code></div><span class="node-footnote">Base física del Page Directory</span></article>`;
}

function cacheCard(current) {
  const snapshot = current?.tlb ?? cache;
  const searched = trace && step >= 1;
  const state = !searched ? 'Por consultar' : trace.hit ? 'HIT · acierto' : 'MISS · búsqueda en tablas';
  const active = ['lookup', 'permissions', 'fill'].includes(current?.key) ? 'tlb-component-active' : '';
  return `<article class="tlb-card tlb-cache ${active} ${current?.key === 'lookup' ? 'component-enter component-loading' : ''}"><div class="tlb-card-heading"><h3>TLB</h3><span id="tlb-status" class="tlb-badge ${searched ? trace.hit ? 'hit' : 'miss' : ''}">${state}</span></div>
    <table aria-label="Entradas de la TLB"><thead><tr><th scope="col">Página · VPN</th><th scope="col">Marco físico</th><th scope="col">RW / US</th></tr></thead><tbody>${Array.from({ length: snapshot.capacity }, (_, index) => {
      const entry = snapshot.entries[index];
      return `<tr class="${entry && searched && entry.vpn === trace.vpn ? 'tlb-match' : ''}"><td>${entry ? hex(entry.vpn, 5) : '—'}</td><td>${entry ? hex(entry.frameBase) : '—'}</td><td>${entry ? `${+entry.writable} / ${+entry.user}` : '—'}</td></tr>`;
    }).join('')}</tbody></table><p class="tlb-card-note">${snapshot.entries.length} / ${snapshot.capacity} entradas · FIFO · no guarda datos</p></article>`;
}

function walkCard(current) {
  const walk = current?.walk ?? {};
  const directoryBase = walk.directoryBase;
  const tableBase = walk.tableBase;
  const directoryRead = walk.pde !== undefined;
  const tableRead = walk.pte !== undefined;
  const tableEntries = tableBase !== undefined ? memory.tables.get(tableBase) : null;
  const directoryAddress = directoryBase !== undefined && trace ? (directoryBase + trace.pdi * 4) >>> 0 : undefined;
  const tableAddress = tableBase !== undefined && trace ? (tableBase + trace.pti * 4) >>> 0 : undefined;
  const stateLabel = read => read ? 'LEÍDA' : 'PENDIENTE';
  const showTable = ['table', 'fill', 'physical'].includes(current?.key);
  return `<section class="tlb-walk" aria-label="Recorrido por Page Directory y Page Table">
    <div class="tlb-walk-summary"><div><strong>Recorrido en RAM</strong><small>CR3 = ${directoryBase !== undefined ? hex(directoryBase) : hex(CR3)}</small></div><span class="tlb-badge">${current ? `${current.reads} lecturas` : 'En espera'}</span></div>
    <div class="tlb-page-tables ${showTable ? '' : 'tlb-one-level'}">
      <article class="tlb-card tlb-level-card tlb-directory-card ${current?.key === 'directory' ? 'tlb-level-active component-enter component-loading' : ''}"><div class="tlb-card-heading"><h3>Page Directory<small>Directorio de páginas</small></h3><span class="tlb-badge">${stateLabel(directoryRead)}</span></div><div class="tlb-level-base"><span>Base</span><code>${directoryBase !== undefined ? hex(directoryBase) : '— — —'}</code></div><table aria-label="Entradas del directorio de páginas en el recorrido TLB"><thead><tr><th scope="col">Índice</th><th scope="col">Entrada · PDE</th><th scope="col"><span class="sr-only">Estado</span></th></tr></thead><tbody>${trace ? levelRows(trace.pdi, memory.directory, { selected: directoryRead }) : ''}</tbody></table><div class="tlb-level-meta"><span>1.024 entradas <b>× 4 bytes</b></span><span>${directoryAddress !== undefined ? `PDE en ${hex(directoryAddress)}` : 'PDE pendiente'}</span></div><div class="tlb-level-index"><span>PDI = <strong>${trace?.pdi ?? '—'}</strong></span><code>${directoryAddress !== undefined ? `base + ${trace.pdi} × 4 → ${hex(directoryAddress)}` : 'Esperando CR3'}</code></div></article>
      ${showTable ? `<span class="tlb-table-arrow ${current?.key === 'table' ? 'component-enter' : ''}" aria-hidden="true">→</span><article class="tlb-card tlb-level-card tlb-page-table-card ${current?.key === 'table' ? 'tlb-level-active component-enter component-loading' : ''}"><div class="tlb-card-heading"><h3>Page Table<small>Tabla de páginas</small></h3><span class="tlb-badge">${stateLabel(tableRead)}</span></div><div class="tlb-level-base"><span>Base</span><code>${tableBase !== undefined ? hex(tableBase) : '— — —'}</code></div><table aria-label="Entradas de la tabla de páginas en el recorrido TLB"><thead><tr><th scope="col">Índice</th><th scope="col">Entrada · PTE</th><th scope="col"><span class="sr-only">Estado</span></th></tr></thead><tbody>${trace ? levelRows(trace.pti, tableEntries, { selected: tableRead }) : ''}</tbody></table><div class="tlb-level-meta"><span>1.024 entradas <b>× 4 bytes</b></span><span>${tableAddress !== undefined ? `PTE en ${hex(tableAddress)}` : 'PTE pendiente'}</span></div><div class="tlb-level-index"><span>PTI = <strong>${trace?.pti ?? '—'}</strong></span><code>${tableAddress !== undefined ? `base + ${trace.pti} × 4 → ${hex(tableAddress)}` : 'Esperando PDE'}</code></div></article>` : ''}
    </div></section>`;
}

function physicalCard(current) {
  const frameBase = current?.frameBase ?? current?.walk?.frameBase;
  const frameKnown = frameBase !== undefined;
  const arrived = current?.physical !== null && current?.physical !== undefined;
  const position = trace ? trace.offset / (PAGE_SIZE - 1) : 0;
  return `<article class="tlb-card tlb-destination ${current?.key === 'physical' ? 'tlb-component-active component-enter' : ''}" aria-label="Address Space de la memoria física"><div class="tlb-card-heading"><h3>Address Space<small>Espacio de direcciones físicas · 32 bits</small></h3><span aria-hidden="true">▥</span></div>
    <div class="tlb-memory-space"><div class="tlb-memory-limit"><span>Primera dirección</span><strong>0x00000000</strong></div><div class="tlb-memory-gap" aria-hidden="true"><i></i><i></i><span>⋮</span></div><div class="tlb-frame ${frameKnown ? 'tlb-frame-known' : ''}"><span>Marco físico de 4 KiB</span><strong>${frameKnown ? hex(frameBase) : '— — —'}</strong><div class="tlb-byte-track">${arrived ? `<i style="left:calc(${position * 100}% - ${position * 10}px)" role="img" aria-label="Byte en offset ${trace.offset}"></i>` : ''}</div></div><div class="tlb-memory-gap" aria-hidden="true"><span>⋮</span><i></i><i></i></div><div class="tlb-memory-limit"><span>Última dirección</span><strong>0xFFFFFFFF</strong></div></div>
    <div class="tlb-destination-result"><div><span>Dirección física</span><small>${arrived ? `Marco + offset ${hex(trace.offset, 3)}` : current?.fault ? 'Acceso detenido · sin byte' : 'Pendiente de completar el recorrido'}</small></div><strong id="tlb-physical" class="tlb-physical">${arrived ? hex(current.physical) : current?.fault ? '#PF' : '—'}</strong></div></article>`;
}

function render() {
  const current = trace?.steps[step];
  const addressBits = trace ? trace.address.toString(2).padStart(32, '0') : '';
  $('#tlb-steps').innerHTML = trace ? trace.steps.map((item, index) => `<li><button class="step-button ${index === step ? 'current' : index < step ? 'complete' : ''}" data-tlb-step="${index}" data-tlb-key="${item.key}" ${index === step ? 'aria-current="step"' : ''}><span class="step-number">${index + 1}</span><span>${item.label}</span></button></li>`).join('') : '<li>Ingresá una dirección válida para comenzar.</li>';
  const isStart = !current || current.key === 'start';
  const showAddress = trace && !isStart;
  const addressMarkup = showAddress ? `<div class="address-breakdown tlb-address-strip ${current.key === 'lookup' ? 'component-enter' : ''}" aria-label="Dirección virtual dividida en directorio, tabla y offset"><div class="address-source"><span>DIRECCIÓN VIRTUAL</span><strong>${hex(trace.address)}</strong></div><span class="split-arrow" aria-hidden="true">=</span><div class="bit-segment blue"><span>Directorio <small>10 bits</small></span><strong id="tlb-pdi">${trace.pdi}</strong><code id="tlb-pdi-bits">${addressBits.slice(0, 10)}</code></div><div class="bit-segment green"><span>Tabla <small>10 bits</small></span><strong id="tlb-pti">${trace.pti}</strong><code id="tlb-pti-bits">${addressBits.slice(10, 20)}</code></div><div class="bit-segment orange"><span>Offset <small>12 bits</small></span><strong id="tlb-offset">${hex(trace.offset, 3)}</strong><code id="tlb-offset-bits">${addressBits.slice(20)}</code></div></div>` : '';
  let pathClass = 'tlb-path-start';
  let pathMarkup = mmuCard(current);
  if (!isStart && ['lookup', 'permissions'].includes(current.key)) {
    pathClass = 'tlb-path-cache';
    pathMarkup = cacheCard(current);
  } else if (!isStart && ['directory', 'table', 'fill'].includes(current.key)) {
    pathClass = 'tlb-path-walk';
    pathMarkup = `${cacheCard(current)}<span class="tlb-path-arrow" aria-hidden="true">→</span>${walkCard(current)}`;
  } else if (!isStart && current.key === 'physical') {
    pathClass = trace.hit ? 'tlb-path-hit-physical' : 'tlb-path-physical';
    pathMarkup = trace.hit
      ? `${cacheCard(current)}<span class="tlb-path-arrow" aria-hidden="true">→</span>${physicalCard(current)}`
      : `${cacheCard(current)}<span class="tlb-path-arrow" aria-hidden="true">→</span>${walkCard(current)}<span class="tlb-path-arrow" aria-hidden="true">→</span>${physicalCard(current)}`;
  }
  $('#tlb-scene').innerHTML = `${addressMarkup}<div class="tlb-path ${pathClass}">${pathMarkup}</div>`;
  $('#tlb-explanation').classList.toggle('fault', Boolean(current?.fault));
  $('#tlb-step-number').textContent = current?.fault ? '!' : trace ? step + 1 : '—';
  $('#tlb-eyebrow').textContent = current?.fault ? 'EXCEPCIÓN #PF' : 'PAGINACIÓN CON TLB';
  $('#tlb-title').textContent = current?.title ?? 'Esperando una dirección válida.';
  $('#tlb-text').textContent = current?.text ?? 'El recorrido anterior se descartó. La TLB conserva solamente accesos ya terminados.';
  $('#tlb-counter').textContent = trace ? `Paso ${step + 1} de ${trace.steps.length}` : 'Sin traducción';
  $('#tlb-previous').disabled = !trace || step === 0;
  $('#tlb-next').disabled = !trace || step === trace.steps.length - 1;
  for (const selector of ['#tlb-restart', '#tlb-play', '#tlb-speed']) $(selector).disabled = !trace;
  $('#tlb-repeat').disabled = !trace || !committed;
  $('#tlb-play').textContent = timer ? 'Ⅱ Pausar' : '▷ Reproducir';
}

function stop() { clearInterval(timer); timer = null; }
function invalidate() {
  stop(); trace = null; step = 0; committed = false; render();
}
function start() {
  stop();
  try {
    const address = parseAddress($('#tlb-address').value);
    trace = planTlbTranslation(address, { tlb: cache, access: $('#tlb-access').value, mode: $('#tlb-mode').value });
    $('#tlb-error').hidden = true;
    $('#tlb-address').removeAttribute('aria-invalid');
    $('#tlb-cache-note').textContent = `TLB inicial: ${cache.entries.length} entradas guardadas. El nuevo acceso se confirma al terminar.`;
    step = 0; committed = false; render();
  } catch (error) {
    $('#tlb-error').textContent = error.message;
    $('#tlb-error').hidden = false;
    $('#tlb-address').setAttribute('aria-invalid', 'true');
    invalidate();
    $('#tlb-address').focus();
  }
}
function move(index) {
  if (!trace) return;
  step = Math.min(trace.steps.length - 1, Math.max(0, index));
  if (step === trace.steps.length - 1) {
    stop();
    // Confirmar una sola vez: retroceder o volver a ver nunca altera FIFO.
    if (!committed) { cache = structuredClone(trace.after); committed = true; }
  }
  render();
}
function play() {
  if (!trace) return;
  if (timer) { stop(); render(); return; }
  if (step === trace.steps.length - 1) step = 0;
  timer = setInterval(() => move(step + 1), Number($('#tlb-speed').value));
  render();
}
$('#tlb-form').addEventListener('submit', event => { event.preventDefault(); start(); });
$('#tlb-address').addEventListener('input', () => {
  $('#tlb-error').hidden = true; $('#tlb-address').removeAttribute('aria-invalid'); $('#tlb-example').value = 'custom'; invalidate();
});
for (const selector of ['#tlb-access', '#tlb-mode']) $(selector).addEventListener('change', () => { $('#tlb-example').value = 'custom'; start(); });
$('#tlb-example').addEventListener('change', () => {
  const scenario = scenarios[Number($('#tlb-example').value)];
  if (!scenario) return;
  cache = preloadTlb(scenario.seed, { mode: 'supervisor' });
  $('#tlb-address').value = scenario.address;
  $('#tlb-access').value = scenario.access;
  $('#tlb-mode').value = 'user';
  start();
  $('#tlb-cache-note').textContent = scenario.seed.length ? 'Ejemplo preparado: la TLB ya contiene las traducciones indicadas.' : 'Ejemplo preparado: se empieza con la TLB vacía.';
});
$('#tlb-next').addEventListener('click', () => { stop(); move(step + 1); });
$('#tlb-previous').addEventListener('click', () => { stop(); move(step - 1); });
$('#tlb-restart').addEventListener('click', () => { stop(); move(0); });
$('#tlb-play').addEventListener('click', play);
$('#tlb-speed').addEventListener('change', () => { if (timer) { stop(); play(); } });
$('#tlb-repeat').addEventListener('click', () => { $('#tlb-example').value = 'custom'; start(); });
$('#tlb-clear').addEventListener('click', () => {
  cache = createTlb(); $('#tlb-example').value = 'custom'; start(); $('#tlb-cache-note').textContent = 'TLB vaciada. La próxima consulta empezará sin traducciones guardadas.';
});
$('#tlb-steps').addEventListener('click', event => {
  const button = event.target.closest('[data-tlb-step]');
  if (button) { stop(); move(Number(button.dataset.tlbStep)); }
});

const help = {
  guide: `<h2>Tu primera traducción con TLB</h2><ol class="guide-list"><li><strong>Empezá con “Miss: TLB vacía”.</strong> El primer paso muestra sólo MMU y CR3. Después se consulta la TLB; si hay miss, Page Directory y Page Table aparecen en pasos sucesivos.</li><li><strong>Terminá el recorrido.</strong> Se guarda la traducción y se suma el offset. Solo al llegar al último paso se confirma la TLB para el siguiente acceso.</li><li><strong>Elegí “Repetir acceso”.</strong> Ahora habrá un hit: las tablas no aparecen porque no se leen. También podés cambiar solo el offset y presionar Traducir.</li><li><strong>Probá los permisos.</strong> “Hit: escritura prohibida” produce #PF aunque la traducción esté en la TLB.</li><li><strong>Volvé a empezar.</strong> Vaciar TLB borra la caché. Ver de nuevo reproduce el mismo recorrido sin modificarla.</li></ol><div class="guide-tip">Traducir conserva la TLB de accesos terminados. Elegir un ejemplo reemplaza su contenido por una preparación conocida. Cambiar de simulación o recargar inicia un laboratorio nuevo.</div><p>Atajos fuera de controles: <kbd>→</kbd> siguiente · <kbd>←</kbd> anterior · <kbd>Espacio</kbd> reproducir o pausar.</p>`,
  theory: `<h2>TLB: recordar una traducción</h2><p>La <strong>Translation Lookaside Buffer</strong> es una caché de traducciones dentro del procesador. Asocia una página virtual con un marco físico y sus permisos; no guarda el contenido del byte.</p>
    <div class="tlb-theory-diagram" aria-label="Dos caminos de traducción"><div class="tlb-theory-start">Dirección virtual<br><strong>VPN (20 bits) + offset (12 bits)</strong></div><div class="tlb-theory-query">↓ Consultar TLB ↓</div><div class="tlb-theory-branches"><section><h3>HIT · acierto</h3><p>Marco y permisos guardados</p><strong>0 lecturas de tablas</strong></section><section><h3>MISS · ausencia</h3><p>CR3 → Page Directory → Page Table</p><strong>Hasta 2 lecturas de tablas</strong><p>Si el acceso es válido, cargar la TLB</p></section></div><div class="tlb-theory-end">Permisos válidos → marco + offset → byte físico<br><strong>Sin presencia o sin permiso → #PF, sin acceso al byte</strong></div></div>
    <details open><summary>El mismo ejemplo, con un atajo</summary><p><code>0x00403010</code> → VPN=<code>0x00403</code>, offset=<code>0x010</code>. En un miss, PDI=1 y PTI=3 conducen al marco <code>0x000AB000</code>. Se guarda VPN → marco y los permisos efectivos. Un acceso a <code>0x00403FFF</code> puede reutilizar la entrada: <code>0x000AB000 + 0xFFF = 0x000ABFFF</code>.</p></details>
    <details><summary>Miss, permisos e invalidación</summary><p>Un miss no es una excepción: x86 puede recorrer las tablas por hardware. Una página no presente o un acceso sin permisos sí provoca #PF. Un hit también puede provocar #PF por protección; R/W y U/S efectivos restringen el acceso y CR0.WP=1 se mantiene en este laboratorio.</p><p>Si el SO cambia una traducción, debe invalidar las entradas pertinentes antes de confiar en el nuevo mapeo. Esta simulación usa un único contexto, CR3 fijo y tablas inmutables; Vaciar TLB es un control didáctico, no una emulación completa de INVLPG o cambios de CR3.</p></details>
    <details><summary>Qué simplifica este laboratorio</summary><p>Cuatro entradas, totalmente asociativas, reemplazo FIFO. Son elecciones didácticas: el tamaño, organización y reemplazo reales dependen del procesador. No se modelan PCID, páginas globales, TLB de múltiples niveles, A/D, cachés de datos ni tiempos reales. Se cargan entradas solo tras un recorrido permitido; no se reproduce la política de llenado de cada microarquitectura.</p><p>Se cuentan lecturas de PDE/PTE, no todos los accesos a RAM. El acceso al dato sigue siendo necesario en un hit. Retroceder muestra instantáneas; confirmar el acceso al final evita modificar la caché al repetir un paso.</p></details>
    <p>Referencia: <a href="https://cdrdv2-public.intel.com/671447/325384-sdm-vol-3abcd.pdf" target="_blank" rel="noreferrer">Intel SDM, volumen 3, secciones 4.10.2 y 4.10.4</a>.</p>`,
  about: `<h2>Tres formas de seguir al byte.</h2><p>Laboratorio educativo independiente para Sistemas Operativos, Ingeniería en Informática, FIUBA. Sin afiliación institucional.</p><p>Elegí Paginación para el recorrido clásico, Paginación con TLB para estudiar traducciones guardadas o Segmentación para trabajar con base, límite y permisos. Cada simulación tiene estado, guía y fundamento propios.</p>`,
};
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  stop(); render();
  $('#tlb-dialog-content').innerHTML = help[button.dataset.dialog];
  $('#tlb-dialog').setAttribute('aria-label', button.textContent);
  $('#tlb-dialog').classList.toggle('tlb-theory-dialog', button.dataset.dialog === 'theory');
  $('#tlb-dialog').showModal(); $('#tlb-dialog').scrollTop = 0;
}));
$('#tlb-close-dialog').addEventListener('click', () => $('#tlb-dialog').close());
$('#tlb-dialog').addEventListener('click', event => {
  if (event.target !== $('#tlb-dialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
document.addEventListener('keydown', event => {
  if (!trace || $('#tlb-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(document.activeElement.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); stop(); move(step + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); move(step - 1); }
  if (event.code === 'Space') { event.preventDefault(); play(); }
});
window.addEventListener('pagehide', stop);
bindSimulationMenu(stop);
start();
