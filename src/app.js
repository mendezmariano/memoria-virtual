import { CR3, PAGE_SIZE, memory, hex, flags, parseAddress, translate, byteAt, examples } from './memory.js';
import { mmuStartContent } from './mmu-view.js';
import { simulationMenu, bindSimulationMenu } from './navigation.js';

const $ = selector => document.querySelector(selector);
const icons = {
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  play: '<path d="m9 5 11 7-11 7z"/>',
  pause: '<path d="M9 5v14M16 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  book: '<path d="M12 6c-3-3-7-3-10-2v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-4-1-7-1-10 2Zm0 0v15"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/><path d="M9 9h6v6H9z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.arrow}</svg>`;
let step = 0;
let result = translate(0x00403010);
let timer = null;
let detailsOpen = false;
const labels = ['MMU y CR3', 'Page Directory', 'Page Table', 'Marco físico', 'Dirección física'];

$('#app').classList.add('paging-app');
$('#app').innerHTML = `
  <header class="site-header">
    <div class="cloud cloud-one"></div><div class="cloud cloud-two"></div>
    <div class="header-inner">
      <a class="brand" href="./" aria-label="Página a página, inicio"><span class="brand-icon">${icon('book')}</span><span>Página a página<small>LABORATORIO DE MEMORIA</small></span></a>
      <nav aria-label="Navegación principal">${simulationMenu('paging')}<button data-dialog="guide">Guía rápida</button><button data-dialog="theory" aria-haspopup="dialog">Esquema teórico</button><button data-dialog="about">Sobre el proyecto ${icon('info')}</button></nav>
      <span class="faculty">FIUBA <span>/</span> Sistemas Operativos</span>
    </div>
  </header>
  <main id="simulador">
    <section class="intro">
      <div><div class="eyebrow"><span></span> DE LA TEORÍA AL BYTE</div><h1>Un viaje por la <span>memoria.</span><svg class="title-spark" viewBox="0 0 40 44" aria-hidden="true"><path d="m5 20 17-12M10 28l23-2M3 12 5 1"/></svg></h1><p>Seguí una dirección virtual hasta su destino físico. Un paso a la vez.</p></div>
      <div class="architecture"><span class="architecture-chip">${icon('chip')}</span><div><strong>x86 · 32 bits</strong><span>Paginación de 2 niveles</span></div><span class="page-tag">4 KiB<br><small>por página</small></span></div>
    </section>
    <section class="input-panel" aria-label="Configuración de la traducción">
      <form id="address-form" novalidate>
        <div class="address-field"><label for="address">Tu dirección virtual <span>HEX</span></label><div class="input-wrap"><span aria-hidden="true">↳</span><input id="address" name="address" value="0x00403010" spellcheck="false" autocomplete="off" maxlength="32" aria-describedby="address-error"/><button class="button yellow translate-button" type="submit">Traducir ${icon('arrow')}</button></div></div>
        <div class="field"><label for="example">Explorá un ejemplo</label><select id="example">${examples.map((e, i) => `<option value="${i}">${e.name}</option>`).join('')}<option value="custom" hidden>Dirección personalizada</option></select></div>
        <div class="field access-field"><label for="access">Tipo de acceso</label><select id="access"><option value="read">Lectura</option><option value="write">Escritura</option></select></div>
        <div class="field mode-field"><label for="mode">Modo</label><select id="mode"><option value="user">Usuario</option><option value="supervisor">Supervisor</option></select></div>
      </form>
      <p id="address-error" class="error" role="alert" hidden></p>
    </section>
    <section class="simulation" aria-label="Recorrido de la traducción">
      <div class="simulation-heading"><div><span class="live-dot"></span><h2>La ruta de tu dirección</h2></div><span class="scene-label">CPU → MMU → RAM</span></div>
      <ol class="stepper" aria-label="Pasos de la traducción">${labels.map((label, i) => `<li><button class="step-button" data-step="${i}"><span class="step-number">${i + 1}</span><span>${label}</span></button></li>`).join('')}</ol>
      <div id="scene"></div>
      <div class="explanation" aria-live="polite" aria-atomic="true"><span class="explanation-number" id="explanation-number"></span><div><div class="explanation-eyebrow" id="explanation-eyebrow"></div><h3 id="explanation-title"></h3><p id="explanation-text"></p></div><div id="explanation-sticker" class="explanation-sticker"></div></div>
      <div class="controls"><button id="reset" class="text-button">${icon('reset')} Reiniciar</button><div class="playback"><button id="autoplay" class="text-button">${icon('play')} Reproducir</button><select id="speed" aria-label="Velocidad de reproducción"><option value="4000">1×</option><option value="2000">2×</option><option value="6500">0,5×</option></select></div><div class="step-controls"><span id="step-counter"></span><button id="previous" class="button previous">${icon('back')} Anterior</button><button id="next" class="button yellow">Siguiente ${icon('arrow')}</button></div></div>
    </section>
    <div class="below-scene"><p>${icon('info')} La página cambia de lugar. El offset viaja intacto.</p><button id="toggle-details" class="text-button" aria-expanded="false" aria-controls="technical-details">${icon('chip')} Mirar debajo del capó <span class="chevron">⌄</span></button></div>
    <section id="technical-details" class="technical-details" hidden></section>
    <footer><span><strong>FIUBA</strong> <span class="footer-divider">/</span> Ingeniería en Informática · Sistemas Operativos</span><span>Hecho para entender, byte a byte.<span class="tiny-blocks"><i></i><i></i><i></i></span></span></footer>
  </main>
  <dialog id="info-dialog"><div class="dialog-top"><span class="eyebrow">PÁGINA A PÁGINA</span><button id="close-dialog" class="icon-button" aria-label="Cerrar">${icon('close')}</button></div><div id="dialog-content"></div></dialog>
`;

function nearbyRows(index) {
  const nearby = index === 1023
    ? [index]
    : Array.from({ length: 3 }, (_, i) => index + i - 1).filter(x => x >= 0 && x <= 1023);
  const rows = new Set([0, ...nearby, 1023]);
  const sorted = [...rows].sort((a, b) => a - b);
  const output = [];
  sorted.forEach((value, i) => { if (i && value - sorted[i - 1] > 1) output.push(null); output.push(value); });
  return output;
}
function tableRows(index, entries, enabled, tone) {
  const rows = nearbyRows(index);
  const finalGap = rows.lastIndexOf(null);
  return rows.map((row, position) => row === null
    ? `<tr class="ellipsis${position === finalGap ? ' ellipsis-to-end' : ''}"><td>⋮</td><td>⋮</td><td></td></tr>`
    : `<tr class="${row === index && enabled ? `selected ${tone}` : ''}"><td>${row === index && enabled ? '<span class="row-pointer">▸</span>' : ''}${row}</td><td>${hex(entries?.get(row) ?? 0)}</td><td>${row === index && enabled ? (entries?.get(row) & 1 ? '✓' : '!') : ''}</td></tr>`).join('');
}
function byteMarker(r) {
  const position = r.offset / (PAGE_SIZE - 1);
  const label = `Byte ${hex(r.physical)} · offset ${r.offset} de ${PAGE_SIZE} bytes`;
  return `<div class="byte-track"><i class="byte-dot" role="img" aria-label="${label}" title="${label}" style="top:calc(${position * 100}% - ${position * 9}px)"></i></div>`;
}
function renderPending() {
  $('.stepper').querySelectorAll('button').forEach((button, i) => {
    button.disabled = true;
    button.classList.remove('current', 'complete');
    button.removeAttribute('aria-current');
    button.querySelector('.step-number').textContent = i + 1;
  });
  for (const selector of ['#previous', '#next', '#reset', '#autoplay', '#speed', '#toggle-details']) $(selector).disabled = true;
  $('#scene').innerHTML = `<div class="empty-scene">${icon('chip')}<p>Ingresá una dirección y presioná <strong>Traducir</strong> para comenzar el recorrido.</p></div>`;
  $('.explanation').classList.remove('fault');
  $('#explanation-number').textContent = '—';
  $('#explanation-eyebrow').textContent = 'ESPERANDO UNA DIRECCIÓN';
  $('#explanation-title').textContent = $('#address-error').hidden ? 'Una nueva dirección, un nuevo recorrido.' : 'Corregí la dirección para continuar.';
  $('#explanation-text').textContent = 'La traducción anterior se descartó. El próximo recorrido usará la dirección, el acceso y el modo elegidos.';
  $('#explanation-sticker').textContent = '';
  $('#step-counter').textContent = 'Sin traducción';
  $('#next').innerHTML = `Siguiente ${icon('arrow')}`;
  $('#autoplay').innerHTML = `${icon('play')} Reproducir`;
  $('#technical-details').replaceChildren();
  $('#technical-details').hidden = true;
  $('#toggle-details').setAttribute('aria-expanded', 'false');
}
function render() {
  if (!result) { renderPending(); return; }
  for (const selector of ['#reset', '#autoplay', '#speed', '#toggle-details']) $(selector).disabled = false;
  $('#technical-details').hidden = !detailsOpen;
  $('#toggle-details').setAttribute('aria-expanded', String(detailsOpen));
  const r = result;
  const faultStep = r.fault?.stage === 2 ? 1 : r.fault?.stage === 3 ? 2 : null;
  const fault = r.fault && step >= faultStep;
  const showDirectory = step >= 1;
  const showTable = step >= 2 && r.fault?.stage !== 2;
  const showPhysical = step >= 3 && !r.fault;
  const bin = r.address.toString(2).padStart(32, '0');
  $('.stepper').querySelectorAll('button').forEach((button, i) => {
    button.classList.toggle('current', step === i);
    button.classList.toggle('complete', step > i);
    button.disabled = Boolean(r.fault && i > faultStep);
    if (i === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    button.querySelector('.step-number').innerHTML = i < step ? icon('check') : i + 1;
  });
  const addressMarkup = step === 0 ? '' : `<div class="address-breakdown ${step === 1 ? 'component-enter' : ''}"><div class="address-source"><span>DIRECCIÓN VIRTUAL</span><strong>${hex(r.address)}</strong></div><span class="split-arrow">=</span><div class="bit-segment blue"><span>Directorio <small>10 bits</small></span><strong>${r.pdi}</strong><code>${bin.slice(0, 10)}</code></div><div class="bit-segment green"><span>Tabla <small>10 bits</small></span><strong>${r.pti}</strong><code>${bin.slice(10, 20)}</code></div><div class="bit-segment orange"><span>Offset <small>12 bits</small></span><strong>${hex(r.offset, 3)}</strong><code>${bin.slice(20)}</code></div><div class="offset-note">Este viaja<br>sin cambios <span>↴</span></div></div>`;
  const directoryMarkup = showDirectory ? `<div class="connector lit blue-line ${step === 1 ? 'component-enter' : ''}" aria-hidden="true"><span>CR3</span><svg viewBox="0 0 45 28"><path d="M1 9h26V2l16 12-16 12v-7H1z"/></svg></div><article class="table-node ${step === 1 ? 'node-active component-enter component-loading' : ''}"><div class="node-title blue"><span class="node-icon">▤</span><h3>Page Directory<small>Directorio de páginas</small></h3><span class="node-index">01</span></div><div class="table-base">Base <code>${hex(r.directoryBase)}</code></div><table aria-label="Entradas del directorio de páginas"><thead><tr><th scope="col">Índice</th><th scope="col">Entrada · PDE</th><th scope="col"><span class="sr-only">Estado</span></th></tr></thead><tbody>${tableRows(r.pdi, memory.directory, true, 'blue')}</tbody></table><div class="table-bottom">1.024 entradas <span>× 4 bytes</span></div><div class="lookup-label blue-label">Índice del directorio = <strong>${r.pdi}</strong></div></article>` : '';
  const tableMarkup = showTable ? `<div class="connector lit green-line ${step === 2 ? 'component-enter' : ''}" aria-hidden="true"><span>PDE</span><svg viewBox="0 0 45 28"><path d="M1 9h26V2l16 12-16 12v-7H1z"/></svg></div><article class="table-node ${step === 2 ? 'node-active component-enter component-loading' : ''}"><div class="node-title green"><span class="node-icon">▤</span><h3>Page Table<small>Tabla de páginas</small></h3><span class="node-index">02</span></div><div class="table-base">Base <code>${hex(r.tableBase)}</code></div><table aria-label="Entradas de la tabla de páginas"><thead><tr><th scope="col">Índice</th><th scope="col">Entrada · PTE</th><th scope="col"><span class="sr-only">Estado</span></th></tr></thead><tbody>${tableRows(r.pti, memory.tables.get(r.tableBase), true, 'green')}</tbody></table><div class="table-bottom">1.024 entradas <span>× 4 bytes</span></div><div class="lookup-label green-label">Índice de la tabla = <strong>${r.pti}</strong></div></article>` : '';
  const physicalMarkup = showPhysical ? `<div class="connector lit orange-line ${step === 3 ? 'component-enter' : ''}" aria-hidden="true"><span>PTE</span><svg viewBox="0 0 45 28"><path d="M1 9h26V2l16 12-16 12v-7H1z"/></svg></div><article class="physical-node ${step >= 3 ? 'node-active' : ''} ${step === 3 ? 'component-enter' : ''}"><div class="physical-heading"><span class="node-icon">▥</span><h3>Memoria física<small>El destino, en la RAM</small></h3></div><div class="memory-stack"><div class="memory-top">⋮</div><div class="memory-frame frame-purple"></div><div class="memory-frame frame-blue"></div><div class="memory-frame frame-active"><span>Marco físico</span><code>${hex(r.frameBase)}</code>${step === 4 ? byteMarker(r) : ''}</div><div class="memory-frame frame-orange"></div><div class="memory-frame frame-pink"></div><div class="memory-bottom">⋮</div><span class="memory-bracket">4 KiB</span></div><div class="physical-result ${step === 4 ? 'arrived' : ''}"><span>${step === 4 ? '¡BYTE ENCONTRADO!' : 'DIRECCIÓN FÍSICA'}</span><strong>${step === 4 ? hex(r.physical) : '—'}</strong></div></article>` : '';
  $('#scene').innerHTML = `${addressMarkup}<div class="journey journey-progressive journey-stage-${Math.min(step, 3)}"><article class="cpu-node mmu-start-card ${step === 0 ? 'node-active component-enter' : ''}">${mmuStartContent({ register: 'CR3', value: hex(CR3), footnote: 'Base física del directorio', focus: step === 0 })}</article>${directoryMarkup}${tableMarkup}${physicalMarkup}</div>`;
  const explanations = [
    ['INICIAMOS LA TRADUCCIÓN', 'Primero, sólo MMU y CR3.', `La MMU recibe ${hex(r.address)}. CR3=${hex(CR3)} indica dónde comienza el Page Directory; las estructuras que todavía no fueron consultadas permanecen ocultas.`, 'Punto de partida'],
    ['CARGAMOS PAGE DIRECTORY', `Aparece el directorio y leemos PDE[${r.pdi}].`, `Los primeros 10 bits dan PDI=${r.pdi}. La MMU lee ${hex(r.directoryBase)} + ${r.pdi} × 4 = ${hex(r.pdeAddress)}. PDE=${hex(r.pde)}; la base de Page Table es ${hex(r.tableBase)}.`, `PDI = ${r.pdi}`],
    ['CARGAMOS PAGE TABLE', `Aparece la tabla y leemos PTE[${r.pti}].`, `Los siguientes 10 bits dan PTI=${r.pti}. La MMU lee ${hex(r.tableBase)} + ${r.pti} × 4 = ${hex(r.pteAddress)}. PTE=${hex(r.pte)}; su base de marco es ${hex(r.frameBase)}.`, `PTI = ${r.pti}`],
    ['UBICAMOS EL MARCO', 'La memoria física aparece recién ahora.', `P, R/W y U/S permiten el acceso. La PTE seleccionó el marco de 4 KiB con base ${hex(r.frameBase)}; todavía falta aplicar el offset ${hex(r.offset, 3)}.`, 'Marco listo'],
    ['SUMAMOS EL OFFSET', '¡Llegamos al byte físico!', `${hex(r.frameBase)} + ${hex(r.offset, 3)} = ${hex(r.physical ?? 0)}. El offset no cambió: avanzamos ${r.offset} bytes dentro del marco. Contenido simulado del byte: ${hex(byteAt(r.physical ?? 0), 2)}.`, '¡Eureka!'],
  ];
  const content = fault ? ['EXCEPCIÓN #PF · PAGE FAULT', 'La traducción se detiene acá.', `${r.fault.message} La CPU informa la excepción al sistema operativo; no se accede al byte solicitado.`, '¡Alto!'] : explanations[step];
  $('.explanation').classList.toggle('fault', Boolean(fault));
  $('#explanation-number').textContent = fault ? '!' : String(step + 1).padStart(2, '0');
  $('#explanation-eyebrow').textContent = content[0];
  $('#explanation-title').textContent = content[1];
  $('#explanation-text').textContent = content[2];
  $('#explanation-sticker').textContent = content[3];
  $('#step-counter').textContent = `Paso ${step + 1} de 5`;
  $('#previous').disabled = step === 0;
  $('#next').disabled = step === 4 || Boolean(fault);
  $('#next').innerHTML = step === 4 ? `Completado ${icon('check')}` : fault ? 'Page fault' : `Siguiente ${icon('arrow')}`;
  $('#autoplay').innerHTML = timer ? `${icon('pause')} Pausar` : `${icon('play')} Reproducir`;
  renderDetails();
}

function renderDetails() {
  const r = result;
  const readableFlags = entry => { const f = flags(entry); return `P=${+f.present} · R/W=${+f.writable} · U/S=${+f.user}`; };
  $('#technical-details').innerHTML = `<div class="detail-heading"><h2>Lo que está haciendo la MMU</h2><span>Valores hexadecimales · índices decimales</span></div><div class="detail-grid"><div><h3>Separación de bits</h3><code>PDI = (VA &gt;&gt; 22) &amp; 0x3FF = ${r.pdi}</code><code>PTI = (VA &gt;&gt; 12) &amp; 0x3FF = ${r.pti}</code><code>Offset = VA &amp; 0xFFF = ${hex(r.offset, 3)}</code></div><div><h3>Entradas de 32 bits</h3><p>PDE: ${step >= 1 ? `<code>${hex(r.pde)} · ${readableFlags(r.pde)}</code>` : 'pendiente de lectura'}</p><p>PTE: ${step >= 2 && r.fault?.stage !== 2 ? `<code>${hex(r.pte)} · ${readableFlags(r.pte)}</code>` : 'pendiente de lectura'}</p><p>Base = entrada &amp; <code>0xFFFFF000</code></p></div><div><h3>Supuestos del laboratorio</h3><p>CR0.PG=1 · CR0.PE=1 · CR0.WP=1<br>CR4.PAE=0 · CR4.PSE=0 · PDE.PS=0</p><p>Segmentación plana; dirección virtual = lineal. Se muestra el recorrido sin acierto de TLB. No se modelan los bits A/D ni cachés.</p></div></div><p class="detail-note">Memoria de ejemplo fija: las entradas no definidas tienen P=0. Cambiar la dirección no crea un mapeo. P=presente, R/W=escritura, U/S=usuario; los permisos se combinan en ambos niveles. El byte mostrado es sintético.</p>`;
  $('#technical-details').insertAdjacentHTML('afterbegin', `<button class="icon-button details-close" aria-label="Cerrar detalles técnicos">${icon('close')}</button>`);
}
function stop() { if (timer) clearInterval(timer); timer = null; }
function invalidateTranslation() {
  stop();
  result = null;
  step = 0;
  render();
}
function startTranslation() {
  stop();
  try {
    result = translate(parseAddress($('#address').value), { access: $('#access').value, mode: $('#mode').value });
    $('#address').value = hex(result.address);
    $('#address-error').hidden = true;
    $('#address').removeAttribute('aria-invalid');
    step = 0;
    render();
  } catch (error) {
    $('#address-error').textContent = error.message;
    $('#address-error').hidden = false;
    $('#address').setAttribute('aria-invalid', 'true');
    $('#address').focus();
    invalidateTranslation();
  }
}
function advance() {
  if (!result) return;
  const faultStep = result.fault?.stage === 2 ? 1 : result.fault?.stage === 3 ? 2 : null;
  if (step < 4 && !(result.fault && step >= faultStep)) step++;
  if (step === 4 || result.fault && step >= faultStep) stop();
  render();
}
$('#address-form').addEventListener('submit', event => { event.preventDefault(); startTranslation(); });
$('#address').addEventListener('input', () => {
  $('#example').value = 'custom';
  $('#address-error').hidden = true;
  $('#address').removeAttribute('aria-invalid');
  invalidateTranslation();
});
$('#example').addEventListener('change', () => {
  const example = examples[Number($('#example').value)];
  if (!example) return;
  $('#address').value = example.address;
  $('#access').value = example.access;
  $('#mode').value = example.mode;
  startTranslation();
});
for (const selector of ['#access', '#mode']) $(selector).addEventListener('change', startTranslation);
$('#next').addEventListener('click', () => { stop(); advance(); });
$('#previous').addEventListener('click', () => { stop(); step = Math.max(0, step - 1); render(); });
$('#reset').addEventListener('click', () => { stop(); step = 0; render(); });
$('.stepper').addEventListener('click', event => { const button = event.target.closest('[data-step]'); if (button && !button.disabled) { stop(); step = Number(button.dataset.step); render(); } });
function play() {
  if (!result) return;
  if (timer) { stop(); render(); return; }
  const faultStep = result.fault?.stage === 2 ? 1 : result.fault?.stage === 3 ? 2 : null;
  if (step === 4 || result.fault && step >= faultStep) step = 0;
  timer = setInterval(advance, Number($('#speed').value));
  render();
}
$('#autoplay').addEventListener('click', play);
$('#speed').addEventListener('change', () => { if (timer) { stop(); play(); } });
$('#toggle-details').addEventListener('click', () => {
  detailsOpen = !detailsOpen;
  $('#technical-details').hidden = !detailsOpen;
  $('#toggle-details').setAttribute('aria-expanded', String(detailsOpen));
});
function closeDetails() {
  detailsOpen = false;
  $('#technical-details').hidden = true;
  $('#toggle-details').setAttribute('aria-expanded', 'false');
  $('#toggle-details').focus();
}
$('#technical-details').addEventListener('click', event => {
  if (event.target.closest('.details-close')) closeDetails();
});
const dialogContent = {
  theory: `<h2>Esquema teórico</h2><figure class="theory-figure"><a href="./resources/esquema-pagina-a-pagina.png" target="_blank" rel="noopener" aria-label="Abrir el esquema teórico en tamaño original"><img src="./resources/esquema-pagina-a-pagina.png" width="1536" height="1024" alt="Página a página: cinco pasos de traducción. Dividir la dirección en 10, 10 y 12 bits; partir de CR3=0x00100000; leer PDE[1]=0x00123007; ir a la tabla en 0x00123000 y leer PTE[3]=0x000AB007; sumar al marco 0x000AB000 el offset 0x010 para llegar al byte físico 0x000AB010. Permisos P, R/W y U/S válidos en ambos niveles." aria-describedby="theory-note"/></a><figcaption id="theory-note">Ejemplo inicial del simulador: <code>0x00403010</code> → PDI=1 · PTI=3 · offset=<code>0x010</code> → <code>0x000AB010</code>. El offset se conserva.</figcaption></figure><a class="theory-original" href="./resources/esquema-pagina-a-pagina.png" target="_blank" rel="noopener">Ver imagen en tamaño original ↗</a>`,
  guide: `<h2>Tu primera traducción</h2><p>Una dirección virtual es una pregunta: ¿en qué byte de la memoria física está mi dato?</p><ol class="guide-list"><li><strong>Elegí una dirección.</strong> Usá el ejemplo inicial o ingresá hasta 8 dígitos hexadecimales.</li><li><strong>Empezá en MMU y CR3.</strong> En el primer paso no se adelantan estructuras: Page Directory y Page Table aparecen animados, uno en cada paso siguiente.</li><li><strong>Avanzá a tu ritmo.</strong> “Siguiente” revela una operación de la MMU. Podés volver atrás o reproducir el recorrido.</li><li><strong>Seguí los colores.</strong> Azul: índice del directorio. Verde: índice de la tabla. Naranja: offset dentro de la página.</li><li><strong>Probá los límites.</strong> Los ejemplos de página ausente y permisos muestran una excepción de página (#PF).</li></ol><div class="guide-tip">Una página y un marco miden lo mismo: <strong>4 KiB = 4096 bytes.</strong> La traducción conserva el desplazamiento dentro de ellos.</div><p>Atajos: <kbd>→</kbd> siguiente · <kbd>←</kbd> anterior · <kbd>Espacio</kbd> reproducir o pausar.</p>`,
  about: `<h2>Sistemas operativos, a la vista.</h2><p>Laboratorio educativo pensado para estudiantes de Ingeniería en Informática de la Facultad de Ingeniería de la Universidad de Buenos Aires. Proyecto independiente, sin afiliación institucional.</p><p>Simula paginación IA-32 de dos niveles, sin PAE, con páginas de 4 KiB y segmentación plana. El directorio y las tablas pertenecen a una memoria de ejemplo fija.</p><p>Referencia técnica: <a href="https://cdrdv2-public.intel.com/782157/325384-sdm-vol-3abcd.pdf" target="_blank" rel="noreferrer">Intel Software Developer’s Manual, volumen 3, capítulo 4</a>.</p><details><summary>Ver las láminas de inspiración</summary><p>Se conservan los colores y los contornos de las referencias, con ilustraciones sin personajes. El cálculo de los índices se realiza a partir de los 32 bits de la dirección.</p><img src="./resources/cf9f7901-13a9-458d-99d1-c3712419a6ae.png" alt="Lámina de referencia de paginación x86" loading="lazy"/><img src="./resources/6d1eadab-da1b-4430-af6c-b5ecbdb6a64f.png" alt="Segunda lámina de referencia de paginación" loading="lazy"/></details>`,
};
document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  stop();
  render();
  const dialog = $('#info-dialog');
  dialog.classList.toggle('theory-dialog', button.dataset.dialog === 'theory');
  dialog.setAttribute('aria-label', button.textContent.trim());
  $('#dialog-content').innerHTML = dialogContent[button.dataset.dialog];
  dialog.showModal();
  dialog.scrollTop = 0;
}));
$('#close-dialog').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && detailsOpen && !$('#info-dialog').open) {
    event.preventDefault();
    closeDetails();
    return;
  }
  if (!result || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(document.activeElement.tagName) || $('#info-dialog').open || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); stop(); advance(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); step = Math.max(0, step - 1); render(); }
  if (event.code === 'Space') { event.preventDefault(); play(); }
});
bindSimulationMenu(stop);
render();
