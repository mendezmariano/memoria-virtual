import { hex, parseAddress } from './memory.js';
import {
  OFFSET_BITS,
  SEGMENT_BITS,
  SEGMENT_ENTRY_SIZE,
  STBR,
  permissionCode,
  planSegmentTranslation,
  segmentationExamples,
  segmentTable,
} from './segmentation.js';
import { bindSimulationMenu, simulationMenu } from './navigation.js';

const $ = selector => document.querySelector(selector);
const accessNames = { read: 'lectura', write: 'escritura', execute: 'ejecución' };
let trace = null;
let step = 0;
let timer = null;

document.title = 'Segmentación · Página a página';
$('#app').classList.add('segmentation-app');
$('#app').innerHTML = `
  <header class="site-header"><div class="cloud cloud-one"></div><div class="cloud cloud-two"></div><div class="header-inner">
    <a class="brand" href="./" aria-label="Página a página, inicio"><span class="brand-icon" aria-hidden="true">▥</span><span>Página a página<small>LABORATORIO DE MEMORIA</small></span></a>
    <nav aria-label="Navegación principal">${simulationMenu('segmentation')}<button data-dialog="guide" aria-haspopup="dialog">Guía rápida</button><button data-dialog="theory" aria-haspopup="dialog">Fundamento teórico</button><button data-dialog="about" aria-haspopup="dialog">Sobre el proyecto</button></nav>
    <span class="faculty">FIUBA <span>/</span> Sistemas Operativos</span>
  </div></header>
  <main class="seg-main">
    <section class="intro"><div><div class="eyebrow">REGIONES CON IDENTIDAD PROPIA</div><h1>Segmentación <span>paso a paso.</span></h1><p>Elegí un segmento, validá su límite y sus permisos, y recién entonces sumá la base.</p></div><div class="architecture"><div><strong>Dirección virtual · 32 bits</strong><span>2 bits de segmento · 30 bits de offset</span></div></div></section>
    <section class="input-panel" aria-label="Configuración de la traducción segmentada"><form id="seg-form" novalidate>
      <div class="address-field"><label for="seg-address">Tu dirección virtual <span>HEX</span></label><div class="input-wrap"><input id="seg-address" value="0x400002A0" maxlength="32" spellcheck="false" autocomplete="off" aria-describedby="seg-error"/><button class="button yellow" type="submit">Traducir →</button></div></div>
      <div class="field"><label for="seg-example">Preparar un ejemplo</label><select id="seg-example">${segmentationExamples.map((example, index) => `<option value="${index}">${example.name}</option>`).join('')}<option value="custom" hidden>Acceso personalizado</option></select></div>
      <div class="field"><label for="seg-access">Tipo de acceso</label><select id="seg-access"><option value="read">Lectura</option><option value="write">Escritura</option><option value="execute">Ejecución</option></select></div>
    </form><p id="seg-error" class="error" role="alert" hidden></p></section>
    <section class="simulation seg-simulation" aria-label="Recorrido de segmentación">
      <div class="simulation-heading"><div><span class="live-dot"></span><h2>La ruta de la traducción</h2></div><span class="scene-label">MMU → TABLA DE SEGMENTOS → RAM</span></div>
      <ol id="seg-steps" class="stepper" aria-label="Pasos de la traducción segmentada"></ol>
      <div id="seg-scene"></div>
      <div id="seg-explanation" class="explanation" aria-live="polite" aria-atomic="true"><span id="seg-step-number" class="explanation-number"></span><div><div id="seg-eyebrow" class="explanation-eyebrow"></div><h3 id="seg-title"></h3><p id="seg-text"></p></div></div>
      <div class="controls seg-controls"><button id="seg-restart" class="text-button">↺ Reiniciar</button><div class="playback"><button id="seg-play" class="text-button">▷ Reproducir</button><select id="seg-speed" aria-label="Velocidad de reproducción"><option value="4000">1×</option><option value="2000">2×</option><option value="6500">0,5×</option></select></div><div class="step-controls"><span id="seg-counter"></span><button id="seg-previous" class="button previous">← Anterior</button><button id="seg-next" class="button yellow">Siguiente →</button></div></div>
    </section>
    <div class="below-scene seg-note"><p><strong>Límite = tamaño.</strong> Un offset es válido sólo si <code>offset &lt; límite</code>; los huecos provocan segmentation fault.</p></div>
    <footer><span><strong>FIUBA</strong> / Ingeniería en Informática · Sistemas Operativos</span><span>Los segmentos son contiguos por separado, no entre sí.</span></footer>
  </main>
  <dialog id="seg-dialog"><div class="dialog-top"><span class="eyebrow">PÁGINA A PÁGINA · SEGMENTACIÓN</span><button id="seg-close-dialog" class="icon-button" aria-label="Cerrar">✕</button></div><div id="seg-dialog-content"></div></dialog>
`;

function mmuCard(current) {
  return `<article class="seg-card seg-mmu-card ${current?.key === 'start' ? 'seg-component-active component-enter' : ''}" aria-label="MMU y registro STBR"><div class="tlb-mmu-chip" role="img" aria-label="Unidad de gestión de memoria"><i></i><strong>MMU</strong><i></i></div><h3>Unidad de gestión de memoria</h3><p>La traducción empieza acá.</p><div class="seg-register-box"><span>STBR</span><code>${hex(STBR)}</code></div><span class="node-footnote">Base física de la tabla de segmentos</span></article>`;
}

function addressStrip(current) {
  if (!trace || current.key === 'start') return '';
  const bits = trace.address.toString(2).padStart(32, '0');
  return `<div class="address-breakdown seg-address-strip ${current.key === 'split' ? 'component-enter seg-component-active' : ''}" aria-label="Dirección virtual dividida en segmento y offset"><div class="address-source"><span>DIRECCIÓN VIRTUAL</span><strong>${hex(trace.address)}</strong></div><span class="split-arrow" aria-hidden="true">=</span><div class="bit-segment blue seg-index-segment"><span>Segmento <small>${SEGMENT_BITS} bits</small></span><strong id="seg-index">${trace.segment}</strong><code id="seg-index-bits">${bits.slice(0, SEGMENT_BITS)}</code></div><div class="bit-segment orange seg-offset-segment"><span>Offset <small>${OFFSET_BITS} bits</small></span><strong id="seg-offset">${hex(trace.offset)}</strong><code id="seg-offset-bits">${bits.slice(SEGMENT_BITS)}</code></div></div>`;
}

function segmentTableCard(current) {
  const selected = trace && ['table', 'validate', 'physical'].includes(current.key);
  return `<article class="seg-card seg-table-card ${current.key === 'table' ? 'seg-component-active component-enter component-loading' : ''}"><div class="seg-card-heading"><h3>Tabla de segmentos<small>STBR = ${hex(STBR)}</small></h3><span class="seg-badge">4 entradas</span></div><table aria-label="Tabla de segmentos"><thead><tr><th scope="col">Seg.</th><th scope="col">Región</th><th scope="col">Base</th><th scope="col">Límite</th><th scope="col">Acceso</th></tr></thead><tbody>${[...segmentTable].map(([index, descriptor]) => `<tr data-segment="${index}" class="${selected && index === trace.segment ? 'seg-row-selected' : ''}"><td>${selected && index === trace.segment ? '<span class="tlb-row-pointer">▸</span>' : ''}${index}</td><td>${descriptor.name}</td><td>${hex(descriptor.base)}</td><td>${hex(descriptor.bound)}</td><td>${permissionCode(descriptor)}</td></tr>`).join('')}</tbody></table><div class="seg-table-foot"><span>Entrada de ${SEGMENT_ENTRY_SIZE} bytes</span><code>${trace ? `${hex(STBR)} + ${trace.segment} × ${SEGMENT_ENTRY_SIZE} = ${hex(trace.entryAddress)}` : '—'}</code></div></article>`;
}

function validationCard(current) {
  const descriptor = trace.descriptor;
  const validLimit = trace.withinBound;
  const validPermission = trace.permitted;
  const permissionChecked = Boolean(descriptor && validLimit);
  const virtualBase = trace.segment * 0x40000000;
  const virtualEnd = virtualBase + (descriptor?.bound ?? 0) - 1;
  const regionEnd = virtualBase + 0x3FFFFFFF;
  const state = value => value ? '<strong class="seg-ok">✓ válido</strong>' : '<strong class="seg-stop">✕ falla</strong>';
  return `<article class="seg-card seg-validation-card ${current.key === 'validate' ? 'seg-component-active component-enter' : ''}"><div class="seg-card-heading"><h3>Validación<small>Antes de sumar la base</small></h3><span class="seg-badge ${current.fault ? 'fault' : 'ok'}">${current.fault ? 'FAULT' : 'OK'}</span></div><div class="seg-check"><span>1 · Límite</span><code>${hex(trace.offset)} &lt; ${descriptor ? hex(descriptor.bound) : '—'}</code>${descriptor ? state(validLimit) : '<strong class="seg-stop">✕ ausente</strong>'}</div><div class="seg-check"><span>2 · Permiso</span><code>${permissionChecked ? `${accessNames[trace.access]} ∈ ${permissionCode(descriptor)}` : 'no evaluado'}</code>${permissionChecked ? state(validPermission) : '<strong>—</strong>'}</div>${descriptor ? `<div class="seg-virtual-mini"><span>Segmento virtual ${trace.segment} · ${descriptor.name}</span><div class="seg-valid-region"><small>Región válida</small><code>${hex(virtualBase)} – ${hex(virtualEnd)}</code></div><div class="seg-gap-region"><small>Hueco sin asignar</small><code>${hex(virtualBase + descriptor.bound)} – ${hex(regionEnd)}</code></div></div>` : ''}</article>`;
}

function physicalCard(current) {
  const selected = trace.segment;
  return `<article class="seg-card seg-physical-card ${current.key === 'physical' ? 'seg-component-active component-enter' : ''}" aria-label="Espacio de direcciones físicas"><div class="seg-card-heading"><h3>Address Space<small>Memoria física · 32 bits</small></h3><span aria-hidden="true">▥</span></div><div class="seg-physical-space"><div class="seg-memory-limit"><span>Primera dirección</span><code>0x00000000</code></div><div class="seg-memory-gap">⋮</div>${[...segmentTable].map(([index, descriptor]) => `<div class="seg-physical-segment seg-${descriptor.tone} ${index === selected ? 'seg-physical-selected' : ''}"><span>${descriptor.name}</span><code>${hex(descriptor.base)} – ${hex(descriptor.base + descriptor.bound - 1)}</code>${index === selected ? `<i style="left:${Math.min(100, trace.offset / Math.max(1, descriptor.bound - 1) * 100)}%" aria-hidden="true"></i>` : ''}</div><div class="seg-memory-gap">⋮</div>`).join('')}<div class="seg-memory-limit"><span>Última dirección</span><code>0xFFFFFFFF</code></div></div><div class="seg-physical-result"><div><span>Dirección física</span><small>base + offset</small></div><strong id="seg-physical">${hex(current.physical)}</strong></div></article>`;
}

function render() {
  const current = trace?.steps[step];
  $('#seg-steps').innerHTML = trace ? trace.steps.map((item, index) => `<li><button class="step-button ${index === step ? 'current' : index < step ? 'complete' : ''}" data-seg-step="${index}" data-seg-key="${item.key}" ${index === step ? 'aria-current="step"' : ''}><span class="step-number">${index + 1}</span><span>${item.label}</span></button></li>`).join('') : '<li>Ingresá una dirección válida para comenzar.</li>';
  if (!current) {
    $('#seg-scene').innerHTML = '<div class="empty-scene"><strong>Sin traducción activa</strong><p>Corregí la dirección y presioná Traducir.</p></div>';
  } else {
    const components = [mmuCard(current)];
    if (step >= 2) components.push('<span class="seg-path-arrow" aria-hidden="true">→</span>', segmentTableCard(current));
    if (step >= 3) components.push('<span class="seg-path-arrow" aria-hidden="true">→</span>', validationCard(current));
    if (current.key === 'physical') components.push('<span class="seg-path-arrow" aria-hidden="true">→</span>', physicalCard(current));
    $('#seg-scene').innerHTML = `${addressStrip(current)}<div class="seg-path seg-path-stage-${step}">${components.join('')}</div>`;
  }
  $('#seg-explanation').classList.toggle('fault', Boolean(current?.fault));
  $('#seg-step-number').textContent = current?.fault ? '!' : current ? step + 1 : '—';
  $('#seg-eyebrow').textContent = current?.fault ? 'EXCEPCIÓN · SEGMENTATION FAULT' : 'SEGMENTACIÓN';
  $('#seg-title').textContent = current?.title ?? 'Esperando una dirección válida.';
  $('#seg-text').textContent = current?.text ?? 'El recorrido anterior fue descartado.';
  $('#seg-counter').textContent = trace ? `Paso ${step + 1} de ${trace.steps.length}` : 'Sin traducción';
  $('#seg-previous').disabled = !trace || step === 0;
  $('#seg-next').disabled = !trace || step === trace.steps.length - 1;
  for (const selector of ['#seg-restart', '#seg-play', '#seg-speed']) $(selector).disabled = !trace;
  $('#seg-play').textContent = timer ? 'Ⅱ Pausar' : '▷ Reproducir';
}

function stop() { clearInterval(timer); timer = null; }
function invalidate() { stop(); trace = null; step = 0; render(); }
function start() {
  stop();
  try {
    trace = planSegmentTranslation(parseAddress($('#seg-address').value), { access: $('#seg-access').value });
    $('#seg-address').value = hex(trace.address);
    $('#seg-error').hidden = true;
    $('#seg-address').removeAttribute('aria-invalid');
    step = 0;
    render();
  } catch (error) {
    $('#seg-error').textContent = error.message;
    $('#seg-error').hidden = false;
    $('#seg-address').setAttribute('aria-invalid', 'true');
    invalidate();
    $('#seg-address').focus();
  }
}
function move(index) {
  if (!trace) return;
  step = Math.min(trace.steps.length - 1, Math.max(0, index));
  if (step === trace.steps.length - 1) stop();
  render();
}
function play() {
  if (!trace) return;
  if (timer) { stop(); render(); return; }
  if (step === trace.steps.length - 1) step = 0;
  timer = setInterval(() => move(step + 1), Number($('#seg-speed').value));
  render();
}

$('#seg-form').addEventListener('submit', event => { event.preventDefault(); start(); });
$('#seg-address').addEventListener('input', () => { $('#seg-error').hidden = true; $('#seg-address').removeAttribute('aria-invalid'); $('#seg-example').value = 'custom'; invalidate(); });
$('#seg-access').addEventListener('change', () => { $('#seg-example').value = 'custom'; start(); });
$('#seg-example').addEventListener('change', () => {
  const example = segmentationExamples[Number($('#seg-example').value)];
  if (!example) return;
  $('#seg-address').value = example.address;
  $('#seg-access').value = example.access;
  start();
});
$('#seg-next').addEventListener('click', () => { stop(); move(step + 1); });
$('#seg-previous').addEventListener('click', () => { stop(); move(step - 1); });
$('#seg-restart').addEventListener('click', () => { stop(); move(0); });
$('#seg-play').addEventListener('click', play);
$('#seg-speed').addEventListener('change', () => { if (timer) { stop(); play(); } });
$('#seg-steps').addEventListener('click', event => {
  const button = event.target.closest('[data-seg-step]');
  if (button) { stop(); move(Number(button.dataset.segStep)); }
});

const help = {
  guide: `<h2>Tu primera traducción segmentada</h2><ol class="guide-list"><li><strong>Empezá por “Datos: lectura válida”.</strong> El primer paso muestra sólo MMU y STBR.</li><li><strong>Separá los 32 bits.</strong> Los 2 superiores eligen uno de cuatro segmentos; los otros 30 forman el offset.</li><li><strong>Leé una sola entrada.</strong> La tabla aporta base, límite y permisos para Código, Datos, Heap o Stack.</li><li><strong>Validá antes de sumar.</strong> Debe cumplirse <code>offset &lt; límite</code> y el acceso tiene que estar permitido.</li><li><strong>Probá un hueco.</strong> “Hueco: offset = límite” se detiene: el límite es tamaño, no el último offset válido.</li></ol><div class="guide-tip">Un segmento es contiguo en memoria física. Segmentos distintos pueden quedar separados y aparecer en otro orden.</div><p>Atajos fuera de controles: <kbd>→</kbd> siguiente · <kbd>←</kbd> anterior · <kbd>Espacio</kbd> reproducir o pausar.</p>`,
  theory: `<h2>Segmentación: base, límite y permisos</h2><p>En vez de un único par base/límite para todo el proceso, el hardware mantiene una tabla: una entrada por región lógica. En este laboratorio hay cuatro segmentos porque se reservan 2 bits para el número de segmento.</p><div class="seg-theory-diagram" aria-label="Traducción mediante una tabla de segmentos"><div class="seg-theory-address"><strong>Dirección virtual</strong><span>Segmento · 2 bits</span><span>Offset · 30 bits</span></div><div class="seg-theory-table">Segmento → <strong>base · límite · R/W/X</strong></div><div class="seg-theory-checks"><span>¿offset &lt; límite?</span><span>¿acceso permitido?</span></div><div class="seg-theory-outcome"><section><strong>Sí</strong><p>base + offset → dirección física</p></section><section><strong>No</strong><p>segmentation fault</p></section></div></div><details open><summary>Por qué aparecen huecos</summary><p>Los bits de segmento dividen el espacio virtual en cuatro regiones grandes, pero cada límite habilita sólo una parte. El resto no pertenece al programa. Saltar, leer o escribir allí genera una excepción; una dirección de 32 bits bien formada no es necesariamente una dirección válida.</p></details><details><summary>Permisos por segmento</summary><p>Código usa R-X; Datos, Heap y Stack usan RW-. Una escritura sobre Código o una ejecución desde Datos falla antes del acceso físico. El ejemplo evita segmentos expand-down y privilegios para concentrarse en base, límite y permisos.</p></details><details><summary>Modelo y fuente</summary><p>La tabla, STBR y el tamaño de entrada son decisiones didácticas explícitas. El concepto sigue a Thomas Anderson y Michael Dahlin, <cite>Operating Systems: Principles and Practice, Volume 3: Memory Management</cite>, capítulo 8, figura 8.3. El diagrama de esta aplicación es una recreación HTML/CSS propia en español.</p></details>`,
  about: `<h2>Tres formas de traducir.</h2><p>Laboratorio educativo independiente para Sistemas Operativos, Ingeniería en Informática, FIUBA. Sin afiliación institucional.</p><p>Elegí Paginación, Paginación con TLB o Segmentación. Cada simulación tiene estado, guía, fundamento y modelo propios; cambiar de laboratorio reinicia su recorrido.</p>`,
};
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  stop(); render();
  $('#seg-dialog-content').innerHTML = help[button.dataset.dialog];
  $('#seg-dialog').setAttribute('aria-label', button.textContent.trim());
  $('#seg-dialog').classList.toggle('seg-theory-dialog', button.dataset.dialog === 'theory');
  $('#seg-dialog').showModal();
  $('#seg-dialog').scrollTop = 0;
}));
$('#seg-close-dialog').addEventListener('click', () => $('#seg-dialog').close());
$('#seg-dialog').addEventListener('click', event => {
  if (event.target !== $('#seg-dialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
document.addEventListener('keydown', event => {
  if (!trace || $('#seg-dialog').open || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(document.activeElement.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); stop(); move(step + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); move(step - 1); }
  if (event.code === 'Space') { event.preventDefault(); play(); }
});
window.addEventListener('pagehide', stop);
bindSimulationMenu(stop);
start();
