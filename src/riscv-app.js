import { mmuStartContent } from './mmu-view.js';
import { bindSimulationMenu, simulationMenu } from './navigation.js';
import {
  PTE_COUNT,
  PTE_R,
  PTE_U,
  PTE_W,
  PTE_X,
  SATP,
  hexRiscv,
  parseRiscvAddress,
  planRiscvTranslation,
  pteFlagCode,
  pteToPa,
  readRiscvPte,
  riscvExamples,
  riscvPageTables,
} from './riscv.js';

const $ = selector => document.querySelector(selector);
const accessNames = { read: 'lectura', write: 'escritura', execute: 'ejecución' };
let trace = null;
let step = 0;
let timer = null;

document.title = 'RISC-V · xv6 · Página a página';
$('#app').classList.add('riscv-app');
$('#app').innerHTML = `
  <header class="site-header"><div class="cloud cloud-one"></div><div class="cloud cloud-two"></div><div class="header-inner">
    <a class="brand" href="./" aria-label="Página a página, inicio"><span class="brand-icon" aria-hidden="true">▥</span><span>Página a página<small>LABORATORIO DE MEMORIA</small></span></a>
    <nav aria-label="Navegación principal">${simulationMenu('riscv')}<button data-rv-dialog="guide" aria-haspopup="dialog">Guía rápida</button><button data-rv-dialog="theory" aria-haspopup="dialog">Fundamento teórico</button><button data-rv-dialog="about" aria-haspopup="dialog">Sobre el proyecto</button></nav>
    <span class="faculty">FIUBA <span>/</span> Sistemas Operativos</span>
  </div></header>
  <main class="rv-main">
    <section class="intro"><div><div class="eyebrow">EL ÁRBOL DE PÁGINAS DE XV6</div><h1>RISC-V Sv39 <span>paso a paso.</span></h1><p>Seguí los tres niveles que recorre la MMU desde <code>satp</code> hasta una hoja.</p></div><div class="architecture"><div><strong>Dirección virtual · 64 bits</strong><span>xv6 usa VA &lt; MAXVA · índices 9/9/9 · offset 12</span></div><span class="page-tag">4 KiB<small>PÁGINA</small></span></div></section>
    <section class="input-panel" aria-label="Configuración de la traducción RISC-V"><form id="rv-form" novalidate>
      <div class="address-field"><label for="rv-address">Tu dirección virtual <span>HEX · 64 BITS</span></label><div class="input-wrap"><input id="rv-address" value="0x0000000000403010" maxlength="18" spellcheck="false" autocomplete="off" aria-describedby="rv-error"/><button class="button yellow" type="submit">Traducir →</button></div></div>
      <div class="field"><label for="rv-example">Preparar un ejemplo</label><select id="rv-example">${riscvExamples.map((example, index) => `<option value="${index}">${example.name}</option>`).join('')}<option value="custom" hidden>Acceso personalizado</option></select></div>
      <div class="field"><label for="rv-access">Acceso desde usuario</label><select id="rv-access"><option value="read">Lectura</option><option value="write">Escritura</option><option value="execute">Ejecución</option></select></div>
    </form><p id="rv-error" class="error" role="alert" hidden></p></section>
    <section class="simulation rv-simulation" aria-label="Recorrido de paginación RISC-V Sv39">
      <div class="simulation-heading"><div><span class="live-dot"></span><h2>El page-table walk de Sv39</h2></div><span class="scene-label">MMU → NIVEL 2 → NIVEL 1 → NIVEL 0 → RAM</span></div>
      <ol id="rv-steps" class="stepper" aria-label="Pasos de la traducción RISC-V"></ol>
      <div id="rv-scene"></div>
      <div id="rv-explanation" class="explanation" aria-live="polite" aria-atomic="true" title="Ctrl + clic para ampliar la explicación"><span id="rv-step-number" class="explanation-number"></span><div class="rv-explanation-copy"><div id="rv-eyebrow" class="explanation-eyebrow" hidden></div><div class="rv-explanation-head"><h3 id="rv-title"></h3><button id="rv-zoom-open" class="rv-zoom-open" type="button" aria-label="Ampliar explicación" title="Ampliar explicación (Ctrl + clic)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 6 6"/></svg></button></div><p id="rv-text"></p><div id="rv-operations" class="rv-operation-list" hidden></div></div></div>
      <div class="controls rv-controls"><button id="rv-restart" class="text-button">↺ Reiniciar</button><div class="playback"><button id="rv-play" class="text-button">▷ Reproducir</button><select id="rv-speed" aria-label="Velocidad de reproducción"><option value="4000">1×</option><option value="2000">2×</option><option value="6500">0,5×</option></select></div><div class="step-controls"><span id="rv-counter"></span><button id="rv-previous" class="button previous">← Anterior</button><button id="rv-next" class="button yellow">Siguiente →</button></div></div>
    </section>
    <div class="below-scene rv-note"><p><strong>No es la tabla x86.</strong> Cada página de tabla contiene 512 PTE de 8 bytes; una entrada ausente conserva V=0 y provoca page fault.</p></div>
    <footer><span><strong>FIUBA</strong> / Ingeniería en Informática · Sistemas Operativos</span><span>Modelo: RISC-V Sv39 según el código y el libro oficial de xv6.</span></footer>
  </main>
  <dialog id="rv-dialog"><div class="dialog-top"><span class="eyebrow">PÁGINA A PÁGINA · RISC-V/XV6</span><button id="rv-close-dialog" class="icon-button" aria-label="Cerrar">✕</button></div><div id="rv-dialog-content"></div></dialog>
  <dialog id="rv-zoom" class="rv-zoom-dialog" aria-labelledby="rv-zoom-title"><div class="rv-zoom-top"><span id="rv-zoom-step"></span><button id="rv-zoom-close" class="icon-button" type="button" aria-label="Cerrar ampliación">✕</button></div><h2 id="rv-zoom-title"></h2><p id="rv-zoom-text"></p><div id="rv-zoom-operations" class="rv-operation-list" hidden></div><small>Esc para cerrar</small></dialog>
`;

function mmuCard(current) {
  const active = current?.key === 'start';
  return `<article class="cpu-node mmu-start-card rv-mmu-card ${active ? 'rv-component-active component-enter' : ''}" aria-label="MMU y registro satp">${mmuStartContent({
    register: 'satp',
    value: hexRiscv(SATP),
    footnote: 'Sv39 · raíz física 0x0000000087FFF000',
    focus: active,
    registerClass: 'rv-satp-box',
  })}</article>`;
}

function addressStrip(current) {
  if (!trace || current.key === 'start') return '';
  const bits = trace.address.toString(2).padStart(39, '0');
  const groups = [
    { label: 'VPN[2]', id: 'rv-vpn2', value: trace.vpn2, bits: bits.slice(0, 9), tone: 'blue' },
    { label: 'VPN[1]', id: 'rv-vpn1', value: trace.vpn1, bits: bits.slice(9, 18), tone: 'green' },
    { label: 'VPN[0]', id: 'rv-vpn0', value: trace.vpn0, bits: bits.slice(18, 27), tone: 'purple' },
    { label: 'Offset', id: 'rv-offset', value: hexRiscv(trace.offset, 3), bits: bits.slice(27), tone: 'orange' },
  ];
  return `<div class="address-breakdown rv-address-strip ${current.key === 'split' ? 'rv-component-active component-enter' : ''}" aria-label="Dirección virtual dividida en tres índices y offset"><div class="address-source"><span>DIRECCIÓN VIRTUAL · bits 63:39 = 0</span><strong>${hexRiscv(trace.address)}</strong></div><span class="split-arrow" aria-hidden="true">=</span>${groups.map(group => `<div class="bit-segment ${group.tone} ${current.name === group.label || current.phase === 'offset' && group.label === 'Offset' ? 'rv-bit-active' : ''}"><span>${group.label} <small>${group.label === 'Offset' ? 12 : 9} bits</small></span><strong id="${group.id}">${group.value}</strong><code id="${group.id}-bits">${group.bits}</code></div>`).join('')}</div>`;
}

function usesSimplifiedExample() {
  return $('#rv-example').value === '0';
}

function tableRows(read, simplified) {
  const table = readRiscvPte.bind(null, read.tableBase);
  const known = [...(riscvPageTables.get(read.tableBase)?.keys() ?? []), read.index];
  const candidates = new Set([0, PTE_COUNT - 1, ...known]);
  if (read.index > 0) candidates.add(read.index - 1);
  if (read.index < PTE_COUNT - 1) candidates.add(read.index + 1);
  const rows = [...candidates].sort((a, b) => a - b);
  let previous = -1;
  const html = [];
  for (const index of rows) {
    if (index - previous > 1) html.push('<tr class="rv-ellipsis"><td colspan="3">⋮</td></tr>');
    const pte = table(index);
    const destination = pte ? pteToPa(pte) : null;
    const kind = !pte ? 'Ausente' : read.level === 0 ? 'Marco' : `Nivel ${read.level - 1}`;
    const cells = simplified
      ? `<td>${destination ? hexRiscv(destination) : '—'}</td><td>${kind}</td>`
      : `<td>${hexRiscv(pte)}</td><td>${pteFlagCode(pte)}</td>`;
    html.push(`<tr data-rv-index="${index}" class="${index === read.index ? 'rv-row-selected' : ''}"><td>${index === read.index ? '<span class="tlb-row-pointer">▸</span>' : ''}${index}</td>${cells}</tr>`);
    previous = index;
  }
  return html.join('');
}

function permissionChecks(current, read, simplified) {
  const visible = ['permissions', 'physical'].includes(current.key);
  if (!visible || read.level !== 0) return '';
  const pte = read.pte;
  const masks = { read: PTE_R, write: PTE_W, execute: PTE_X };
  const user = Boolean(pte & PTE_U);
  const operation = Boolean(pte & masks[trace.access]);
  const userLabel = simplified ? 'Modo usuario' : 'Usuario · PTE_U';
  const operationLabel = simplified ? accessNames[trace.access] : `${accessNames[trace.access]} · PTE_${{ read: 'R', write: 'W', execute: 'X' }[trace.access]}`;
  return `<div class="rv-permission-checks ${current.fault ? 'fault' : ''}"><span>${userLabel} ${user ? '✓' : '✕'}</span><span>${operationLabel} ${operation ? '✓' : '✕'}</span></div>`;
}

function tableCard(read, current, simplified) {
  const active = current.read === read || current.key === 'permissions' && read.level === 0;
  const names = { 2: 'Nivel 2 · raíz', 1: 'Nivel 1', 0: 'Nivel 0 · hoja' };
  const tone = { 2: 'blue', 1: 'green', 0: 'orange' }[read.level];
  const destination = read.valid ? read.nextBase : null;
  const columns = simplified
    ? '<th scope="col">Índice</th><th scope="col">Destino físico</th><th scope="col">Lleva a</th>'
    : '<th scope="col">Índice</th><th scope="col">PTE de 64 bits</th><th scope="col">DAGUXWRV</th>';
  const entryLabel = simplified ? 'Entrada' : 'PTE';
  return `<article class="rv-table-card rv-${tone} ${active ? 'rv-component-active component-enter component-loading' : ''}" aria-label="Tabla de páginas de nivel ${read.level}"><div class="rv-card-heading"><h3>${names[read.level]}<small>base ${hexRiscv(read.tableBase)}</small></h3><span>${PTE_COUNT} ${simplified ? 'entradas' : 'PTE'}</span></div><table><thead><tr>${columns}</tr></thead><tbody>${tableRows(read, simplified)}</tbody></table><div class="rv-table-read"><span>${entryLabel}[${read.index}] @</span><code>${hexRiscv(read.pteAddress)}</code><small>${destination ? `${read.level ? 'próxima tabla' : 'marco'} ${hexRiscv(destination)}` : simplified ? 'entrada ausente · sin destino' : 'V=0 · sin destino'}</small></div>${permissionChecks(current, read, simplified)}</article>`;
}

function explanationText(current, simplified) {
  if (!simplified) return current.text;
  if (current.key === 'permissions') return `La página admite acceso desde modo usuario y permite ${accessNames[trace.access]}. La MMU puede continuar.`;
  const read = current.read;
  if (!read || current.fault) return current.text;
  const destinationName = read.level ? `la tabla de nivel ${read.level - 1}` : 'el marco físico';
  return `En ${hexRiscv(read.tableBase)}, el índice ${read.index} selecciona la entrada ubicada en ${hexRiscv(read.pteAddress)}. Esa entrada conduce a ${destinationName} ${hexRiscv(read.nextBase)}.`;
}

function permissionMask() {
  return { read: PTE_R, write: PTE_W, execute: PTE_X }[trace.access];
}

function operationItems(current) {
  if (!trace?.detailed || !current) return [];
  if (current.key === 'start') {
    const rootPpn = trace.root >> 12n;
    const items = [
      { label: `${trace.expanded ? '2' : '1'} · Extraer PPN raíz`, expression: `${hexRiscv(trace.satp)} & 0x00000FFFFFFFFFFF`, result: hexRiscv(rootPpn) },
      { label: `${trace.expanded ? '3' : '2'} · Formar base`, expression: `${hexRiscv(rootPpn)} << 12`, result: hexRiscv(trace.root) },
    ];
    if (trace.expanded) items.unshift({ label: '1 · Confirmar Sv39', expression: `(${hexRiscv(trace.satp)} >> 60) & 0xF`, result: '0x8 = MODE Sv39' });
    return items;
  }
  if (current.key === 'split') {
    if (trace.expanded) return [];
    return [
      { label: 'VPN[2]', expression: `(VA >> 30) & 0x1FF`, result: String(trace.vpn2) },
      { label: 'VPN[1]', expression: `(VA >> 21) & 0x1FF`, result: String(trace.vpn1) },
      { label: 'VPN[0]', expression: `(VA >> 12) & 0x1FF`, result: String(trace.vpn0) },
      { label: 'Offset', expression: 'VA & 0xFFF', result: hexRiscv(trace.offset, 3) },
    ];
  }
  if (current.phase === 'index') {
    const nineBits = BigInt(current.index).toString(2).padStart(9, '0');
    return [
      { label: '1 · VA original', expression: 'Dirección virtual', result: hexRiscv(trace.address) },
      { label: `2 · Descartar ${current.shift} bits bajos`, expression: `${hexRiscv(trace.address)} >> ${current.shift}`, result: hexRiscv(current.shifted) },
      { label: '3 · Conservar 9 bits', expression: `${hexRiscv(current.shifted)} & 0x1FF`, result: `${hexRiscv(BigInt(current.index), 3)} = ${current.index} = ${nineBits}₂` },
    ];
  }
  if (current.phase === 'offset') {
    return [
      { label: '1 · VA original', expression: 'Dirección virtual', result: hexRiscv(trace.address) },
      { label: '2 · Conservar 12 bits bajos', expression: `${hexRiscv(trace.address)} & 0xFFF`, result: `${hexRiscv(trace.offset, 3)} = ${trace.offset.toString(2).padStart(12, '0')}₂` },
    ];
  }
  if (current.phase === 'lookup') {
    const read = current.read;
    const displacement = BigInt(read.index) * 8n;
    return [
      { label: '1 · Desplazamiento', expression: trace.expanded ? `${read.index} << 3 = ${read.index} × 8 bytes` : `${read.index} × 8 bytes`, result: hexRiscv(displacement, 3) },
      { label: '2 · Dirección de PTE', expression: `${hexRiscv(read.tableBase)} + ${hexRiscv(displacement, 3)}`, result: hexRiscv(read.pteAddress) },
      { label: '3 · Lectura física', expression: `Mem[${hexRiscv(read.pteAddress)}]`, result: hexRiscv(read.pte) },
    ];
  }
  if (current.phase === 'metadata') {
    const read = current.read;
    const decoded = read.decoded;
    const rsw = decoded.rsw.toString(2).padStart(2, '0');
    const metadata = [`RSW[1:0]=${rsw}`, ...['D', 'A', 'G', 'U', 'X', 'W', 'R', 'V'].map(name => `${name}=${Number(decoded.flags[name])}`)].join(' ');
    const items = [
      { label: '1 · Metadata', expression: `${hexRiscv(read.pte)} & 0x3FF`, result: trace.expanded ? `${hexRiscv(decoded.metadata, 3)} = ${decoded.metadata.toString(2).padStart(10, '0')}₂` : hexRiscv(decoded.metadata, 3) },
      { label: '2 · Metadata · bits 9→0', expression: 'orden real dentro de la PTE', result: metadata },
    ];
    if (!trace.expanded) {
      items.push({ label: '3 · Extraer PPN', expression: `(PTE >> 10) & 0xFFFFFFFFFFF`, result: hexRiscv(decoded.ppn) });
      items.push(read.valid
        ? { label: `4 · ${read.level ? 'Próxima tabla' : 'Marco'}`, expression: `${hexRiscv(decoded.ppn)} << 12`, result: hexRiscv(read.nextBase) }
        : { label: '4 · Decisión', expression: 'V=0', result: 'Page fault · el PPN no se usa' });
    }
    return items;
  }
  if (current.phase === 'ppn') {
    const read = current.read;
    const shifted = read.pte >> 10n;
    return [
      { label: '1 · Quitar metadata', expression: `${hexRiscv(read.pte)} >> 10`, result: hexRiscv(shifted) },
      { label: '2 · Aislar PPN de 44 bits', expression: `${hexRiscv(shifted)} & 0xFFFFFFFFFFF`, result: hexRiscv(read.decoded.ppn) },
      { label: `3 · ${read.level ? 'Base de próxima tabla' : 'Marco físico'}`, expression: `${hexRiscv(read.decoded.ppn)} << 12`, result: hexRiscv(read.nextBase) },
    ];
  }
  if (current.key === 'permissions') {
    const leaf = trace.reads.at(-1).pte;
    const required = permissionMask();
    return [
      { label: '1 · Acceso de usuario', expression: `${hexRiscv(leaf)} & ${hexRiscv(PTE_U, 3)}`, result: leaf & PTE_U ? `${hexRiscv(PTE_U, 3)}${trace.expanded ? ' → U=1' : ''}` : '0x000 · denegado' },
      { label: `2 · Permiso de ${accessNames[trace.access]}`, expression: `${hexRiscv(leaf)} & ${hexRiscv(required, 3)}`, result: leaf & required ? `${hexRiscv(required, 3)}${trace.expanded ? ` → ${{ read: 'R', write: 'W', execute: 'X' }[trace.access]}=1` : ''}` : '0x000 · denegado' },
      { label: '3 · Decisión', expression: 'usuario + operación', result: current.fault ? 'Page fault' : 'Acceso autorizado' },
    ];
  }
  if (current.key === 'physical') {
    const items = [
      { label: 'Marco', expression: 'PPN de la hoja << 12', result: hexRiscv(trace.frame) },
      { label: 'Offset', expression: 'VA & 0xFFF', result: hexRiscv(trace.offset, 3) },
      { label: 'Dirección física', expression: `${hexRiscv(trace.frame)} + ${hexRiscv(trace.offset, 3)}`, result: hexRiscv(trace.physical) },
    ];
    if (trace.expanded) items.push({ label: 'Equivalente bit a bit', expression: `${hexRiscv(trace.frame)} | ${hexRiscv(trace.offset, 3)}`, result: hexRiscv(trace.physical) });
    return items;
  }
  return [];
}

function renderOperations(current) {
  const items = operationItems(current);
  const container = $('#rv-operations');
  $('#rv-explanation').classList.toggle('has-operations', items.length > 0);
  container.hidden = items.length === 0;
  container.innerHTML = operationMarkup(items);
}

function operationMarkup(items) {
  return items.map(item => `<div><span>${item.label}</span><code>${item.expression}</code><strong>= ${item.result}</strong></div>`).join('');
}

function openExplanationZoom() {
  const current = trace?.steps[step];
  if (!current || $('#rv-zoom').open) return;
  stop();
  render();
  const items = operationItems(current);
  $('#rv-zoom-step').textContent = current.fault ? `EXCEPCIÓN · PASO ${step + 1}` : `PASO ${step + 1} DE ${trace.steps.length}`;
  $('#rv-zoom-title').textContent = current.title;
  $('#rv-zoom-text').textContent = explanationText(current, usesSimplifiedExample());
  $('#rv-zoom-operations').hidden = items.length === 0;
  $('#rv-zoom-operations').innerHTML = operationMarkup(items);
  $('#rv-zoom').showModal();
}

function physicalCard() {
  const percent = Number(trace.offset) / 4095 * 100;
  return `<article class="rv-physical-card rv-component-active component-enter" aria-label="Espacio de direcciones físicas"><div class="rv-card-heading"><h3>Address Space<small>Memoria física · hasta 56 bits</small></h3><span>RAM</span></div><div class="rv-physical-space"><div class="rv-memory-limit"><span>Primera dirección</span><code>0x0000000000000000</code></div><div class="rv-memory-gap">⋮</div><div class="rv-xv6-ram"><span>RAM que usa xv6 en QEMU</span><code>0x0000000080000000 – 0x0000000087FFFFFF</code><div class="rv-frame"><small>Marco de 4 KiB</small><strong>${hexRiscv(trace.frame)}</strong><div class="rv-byte-track"><i style="left:${percent}%" aria-hidden="true"></i></div></div></div><div class="rv-memory-gap">⋮</div><div class="rv-memory-limit"><span>Última dirección física</span><code>0x00FFFFFFFFFFFFFF</code></div></div><div class="rv-physical-result"><div><span>Dirección física</span><small>PPN de la hoja + offset</small></div><strong id="rv-physical">${hexRiscv(trace.physical)}</strong></div></article>`;
}

function render() {
  const current = trace?.steps[step];
  $('#rv-steps').classList.toggle('rv-steps-detailed', Boolean(trace?.detailed));
  $('#rv-steps').classList.toggle('rv-steps-expanded', Boolean(trace?.expanded));
  $('#rv-steps').innerHTML = trace ? trace.steps.map((item, index) => `<li><button class="step-button ${index === step ? 'current' : index < step ? 'complete' : ''}" data-rv-step="${index}" data-rv-key="${item.key}" ${index === step ? 'aria-current="step"' : ''}><span class="step-number">${index + 1}</span><span>${item.label}</span></button></li>`).join('') : '<li>Ingresá una dirección válida para comenzar.</li>';
  if (trace?.expanded) {
    const stepper = $('#rv-steps');
    const selected = stepper.querySelector('[aria-current="step"]');
    stepper.scrollLeft = selected.getBoundingClientRect().left - stepper.getBoundingClientRect().left + stepper.scrollLeft - (stepper.clientWidth - selected.offsetWidth) / 2;
  }
  if (!current) {
    $('#rv-scene').innerHTML = '<div class="empty-scene"><strong>Sin traducción activa</strong><p>Corregí la dirección y presioná Traducir.</p></div>';
  } else {
    const simplified = usesSimplifiedExample();
    const revealed = new Set(trace.steps.slice(0, step + 1).map(item => item.key));
    const cards = [mmuCard(current)];
    for (const read of trace.reads) {
      if (revealed.has(read.key)) cards.push(tableCard(read, current, simplified));
    }
    if (current.key === 'physical') cards.push(physicalCard());
    const path = cards.map((card, index) => `${index ? '<span class="rv-path-arrow" aria-hidden="true">→</span>' : ''}${card}`).join('');
    $('#rv-scene').innerHTML = `${addressStrip(current)}<div class="rv-path rv-path-count-${cards.length}">${path}</div>`;
  }
  $('#rv-explanation').classList.toggle('fault', Boolean(current?.fault));
  $('#rv-step-number').textContent = current?.fault ? '!' : current ? step + 1 : '—';
  $('#rv-eyebrow').hidden = !current?.fault;
  $('#rv-eyebrow').textContent = current?.fault ? 'EXCEPCIÓN · PAGE FAULT' : '';
  $('#rv-title').textContent = current?.title ?? 'Esperando una dirección válida.';
  $('#rv-text').textContent = current ? explanationText(current, usesSimplifiedExample()) : 'El recorrido anterior fue descartado.';
  $('#rv-zoom-open').disabled = !current;
  renderOperations(current);
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
    trace = planRiscvTranslation(parseRiscvAddress($('#rv-address').value), {
      access: $('#rv-access').value,
      detailed: !usesSimplifiedExample(),
      expanded: $('#rv-example').value === '1',
    });
    $('#rv-address').value = hexRiscv(trace.address);
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
  timer = setInterval(() => move(step + 1), Number($('#rv-speed').value));
  render();
}

$('#rv-form').addEventListener('submit', event => { event.preventDefault(); start(); });
$('#rv-address').addEventListener('input', () => { $('#rv-error').hidden = true; $('#rv-address').removeAttribute('aria-invalid'); $('#rv-example').value = 'custom'; invalidate(); });
$('#rv-access').addEventListener('change', () => { $('#rv-example').value = 'custom'; start(); });
$('#rv-example').addEventListener('change', () => {
  const example = riscvExamples[Number($('#rv-example').value)];
  if (!example) return;
  $('#rv-address').value = example.address;
  $('#rv-access').value = example.access;
  start();
});
$('#rv-next').addEventListener('click', () => { stop(); move(step + 1); });
$('#rv-previous').addEventListener('click', () => { stop(); move(step - 1); });
$('#rv-restart').addEventListener('click', () => { stop(); move(0); });
$('#rv-play').addEventListener('click', play);
$('#rv-speed').addEventListener('change', () => { if (timer) { stop(); play(); } });
$('#rv-steps').addEventListener('click', event => {
  const button = event.target.closest('[data-rv-step]');
  if (button) { stop(); move(Number(button.dataset.rvStep)); }
});
$('#rv-explanation').addEventListener('click', event => {
  if (event.button !== 0 || !event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  openExplanationZoom();
});
$('#rv-zoom-open').addEventListener('click', event => {
  event.stopPropagation();
  openExplanationZoom();
});
$('#rv-zoom-close').addEventListener('click', () => $('#rv-zoom').close());
$('#rv-zoom').addEventListener('click', event => {
  if (event.target !== $('#rv-zoom')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});

function riscvTheoryContent() {
  return `<article class="rv-theory-article">
    <header class="rv-theory-hero">
      <span class="eyebrow">RISC-V · SV39 · XV6</span>
      <h2>De la dirección virtual a la memoria física</h2>
      <p>La <strong>MMU realiza la traducción por hardware</strong>. El kernel de xv6 <strong>construye, completa y modifica</strong> las tablas que la MMU consulta.</p>
      <div class="rv-responsibility-grid">
        <section><span>HARDWARE</span><strong>MMU</strong><p>Parte de <code>satp</code>, recorre las PTE, valida permisos y produce la dirección física o una excepción sincrónica.</p></section>
        <section><span>SOFTWARE</span><strong>Kernel xv6</strong><p>Reserva páginas, instala mapeos, copia espacios de usuario y activa la tabla raíz de cada contexto.</p></section>
      </div>
    </header>

    <section class="rv-theory-section" id="rv-theory-addresses">
      <div class="rv-section-title"><span>1</span><div><h3>Anatomía de una dirección Sv39</h3><p>RV64 entrega direcciones de 64 bits, pero Sv39 usa 39 bits para traducir.</p></div></div>
      <div class="rv-theory-diagram rv-wide-diagram" role="img" aria-label="Dirección virtual Sv39: extensión de signo, VPN de niveles 2, 1 y 0, y offset">
        <div class="rv-va64">
          <span class="rv-sign"><b>63…39</b><strong>Extensión de signo</strong><small>25 bits · copian bit 38</small></span>
          <span class="rv-vpn2"><b>38…30</b><strong>VPN[2]</strong><small>9 bits</small></span>
          <span class="rv-vpn1"><b>29…21</b><strong>VPN[1]</strong><small>9 bits</small></span>
          <span class="rv-vpn0"><b>20…12</b><strong>VPN[0]</strong><small>9 bits</small></span>
          <span class="rv-page-offset"><b>11…0</b><strong>Offset</strong><small>12 bits</small></span>
        </div>
      </div>
      <div class="rv-theory-note"><strong>Sv39 general y xv6 no aceptan exactamente el mismo intervalo.</strong><p>Sv39 exige que los bits 63:39 sean iguales al bit 38; si no, genera una excepción page fault. <code>walk()</code> de xv6 simplifica el modelo y acepta solamente <code>0 ≤ VA &lt; MAXVA = 1 &lt;&lt; 38</code>: en el laboratorio, los bits 63:38 siempre valen cero.</p></div>
      <div class="rv-nine-bit-grid">
        <div><span>Página de tabla</span><strong>4096 bytes</strong></div><b>÷</b><div><span>Tamaño de PTE</span><strong>8 bytes</strong></div><b>=</b><div><span>Entradas</span><strong>512 = 2<sup>9</sup></strong></div>
      </div>
      <p class="rv-caption">Por eso cada VPN tiene 9 bits: selecciona exactamente una de las 512 PTE de la página de tabla.</p>
    </section>

    <section class="rv-theory-section" id="rv-theory-bitwise">
      <div class="rv-section-title"><span>2</span><div><h3>Máscaras y desplazamientos</h3><p>Las macros de <code>kernel/riscv.h</code> aíslan índices, metadata y PPN.</p></div></div>
      <div class="rv-code-grid">
        <pre class="rv-code-block"><code>#define PGSHIFT 12
#define PXMASK  0x1FF
#define PXSHIFT(level) (PGSHIFT + 9 * level)
#define PX(level, va)  ((va &gt;&gt; PXSHIFT(level)) &amp; PXMASK)</code></pre>
        <div class="rv-shift-list">
          <div><strong>Nivel 2</strong><code>PXSHIFT(2) = 30</code><span>descarta offset, VPN[0] y VPN[1]</span></div>
          <div><strong>Nivel 1</strong><code>PXSHIFT(1) = 21</code><span>descarta offset y VPN[0]</span></div>
          <div><strong>Nivel 0</strong><code>PXSHIFT(0) = 12</code><span>descarta solamente el offset</span></div>
        </div>
      </div>
      <p class="rv-mask-note"><code>&amp; 0x1FF</code> conserva los 9 bits del índice y descarta los superiores: el resultado siempre está entre 0 y 511.</p>

      <h4>Anatomía de una PTE de 64 bits</h4>
      <div class="rv-pte-scroll">
        <div class="rv-pte-layout" role="img" aria-label="PTE Sv39 con bits de extensiones, PPN, RSW y flags">
          <span class="rv-pte-reserved"><b>63…54</b><strong>Extensiones / reservados</strong><small>10 bits</small></span>
          <span class="rv-pte-ppn"><b>53…10</b><strong>PPN</strong><small>44 bits</small></span>
          <span class="rv-pte-rsw"><b>9…8</b><strong>RSW</strong><small>2 bits</small></span>
          <span class="rv-pte-flags"><b>7…0</b><strong>D A G U X W R V</strong><small>8 flags</small></span>
        </div>
      </div>
      <p class="rv-caption">En el formato base usado por xv6, los bits superiores no participan del mapeo. Algunas extensiones modernas asignan significado a 63 y 62:61; si no están implementadas, deben permanecer en cero.</p>
      <div class="rv-pte-operation-grid">
        <section><span>Extraer metadata</span><code>PTE_FLAGS(pte) = pte &amp; 0x3FF</code><p>Conserva bits 9:0: RSW y flags.</p></section>
        <section><span>Extraer la base física</span><code>PTE2PA(pte) = (pte &gt;&gt; 10) &lt;&lt; 12</code><p>Quita metadata, obtiene el PPN y agrega 12 ceros.</p></section>
        <section><span>Construir una PTE</span><code>PA2PTE(pa) = (pa &gt;&gt; 12) &lt;&lt; 10</code><p>Quita el offset y deja libres los 10 bits bajos.</p></section>
      </div>
      <div class="rv-mini-example"><span>Ejemplo del laboratorio</span><code>0x0000000021FFF801 &gt;&gt; 10 = 0x0000000000087FFE</code><code>0x0000000000087FFE &lt;&lt; 12 = 0x0000000087FFE000</code></div>
    </section>

    <section class="rv-theory-section" id="rv-theory-hardware">
      <div class="rv-section-title"><span>3</span><div><h3>Recorrido de la MMU, paso a paso</h3><p>Este es el camino de hardware cuando no hay una traducción aprovechable en la TLB.</p></div></div>
      <ol class="rv-hardware-flow">
        <li><span>1</span><div><strong>Raíz desde <code>satp</code></strong><p><code>tabla2 = satp.PPN &lt;&lt; 12</code>. En xv6, <code>MODE=8</code> selecciona Sv39.</p></div></li>
        <li><span>2</span><div><strong>Nivel 2</strong><p><code>idx2 = PX(2, va)</code> y <code>pte2 = Mem[tabla2 + idx2 × 8]</code>. Si V=0 hay page fault. Si V=1 y R=W=X=0, es un puntero: <code>tabla1 = PTE2PA(pte2)</code>. Una hoja en este nivel describiría una superpágina de 1 GiB.</p></div></li>
        <li><span>3</span><div><strong>Nivel 1</strong><p><code>idx1 = PX(1, va)</code> y <code>pte1 = Mem[tabla1 + idx1 × 8]</code>. Se repite la validación. Con V=1 y R=W=X=0, <code>tabla0 = PTE2PA(pte1)</code>; una hoja aquí describiría 2 MiB.</p></div></li>
        <li><span>4</span><div><strong>Nivel 0 · hoja de 4 KiB</strong><p><code>idx0 = PX(0, va)</code>. La MMU lee <code>pte0</code> y valida V, la combinación R/W/X, U y el permiso exigido por la operación.</p></div></li>
        <li><span>5</span><div><strong>Composición física</strong><p><code>PA = PTE2PA(pte0) | (va &amp; 0xFFF)</code>. Como la base termina en 12 ceros, usar OR o sumar el offset produce el mismo resultado.</p></div></li>
      </ol>
      <div class="rv-fault-rules">
        <strong>Cuándo se detiene</strong>
        <ul><li><code>V=0</code>, bits reservados inválidos o <code>W=1, R=0</code>.</li><li>La hoja no autoriza lectura, escritura, ejecución o acceso desde usuario.</li><li>El resultado es una excepción sincrónica: <em>instruction</em>, <em>load</em> o <em>store page fault</em>; no es una interrupción.</li></ul>
      </div>
      <p class="rv-caption">Sv39 permite hojas en niveles 2 y 1 para páginas de 1 GiB y 2 MiB. Este laboratorio sigue el árbol de páginas de 4 KiB que construye xv6 y no modela superpáginas ni actualización automática de A/D.</p>
    </section>

    <section class="rv-theory-section" id="rv-theory-kernel">
      <div class="rv-section-title"><span>4</span><div><h3>Qué hace xv6 en <code>kernel/vm.c</code></h3><p>Estas funciones manipulan el mismo formato de tablas desde software; no reemplazan el recorrido de hardware de la MMU.</p></div></div>
      <div class="rv-function-grid">
        <section><code>walk(pagetable, va, alloc)</code><p>Recorre por software los niveles 2 y 1. Si falta una tabla y <code>alloc != 0</code>, reserva una página con <code>kalloc()</code>, la pone en cero e instala una PTE intermedia con V. Devuelve un puntero a la PTE de nivel 0.</p></section>
        <section><code>mappages(pagetable, va, size, pa, perm)</code><p>Exige VA y tamaño alineados. Avanza de a 4 KiB, llama a <code>walk(..., 1)</code> e instala <code>PA2PTE(pa) | perm | PTE_V</code>. El nombre correcto es <strong>mappages</strong>.</p></section>
        <section><code>uvmcopy(old, new, sz)</code><p>Durante <code>fork()</code>, recorre las páginas mapeadas del padre, conserva sus flags, reserva memoria para el hijo, copia 4 KiB e instala el nuevo mapeo.</p></section>
        <section><code>copyin(...)</code> / <code>copyout(...)</code><p>Traducen direcciones de usuario con <code>walkaddr()</code> para copiar por tramos de página. La versión actual también puede resolver una página lazy mediante <code>vmfault()</code>; <code>copyout</code> exige W.</p></section>
        <section class="rv-function-wide"><code>kvminithart()</code><pre class="rv-code-block"><code>sfence_vma();\nw_satp(MAKE_SATP(kernel_pagetable));\nsfence_vma();</code></pre><p>La primera barrera espera escrituras previas sobre las tablas; la segunda descarta traducciones viejas de la TLB después de activar la raíz.</p></section>
      </div>
    </section>

    <footer class="rv-theory-sources"><strong>Fuentes primarias</strong><a href="https://docs.riscv.org/reference/isa/priv/supervisor.html#sv39-page-based-39-bit-virtual-memory-system" target="_blank" rel="noreferrer">Especificación privilegiada RISC-V · Sv39</a><a href="https://github.com/mit-pdos/xv6-riscv/blob/riscv/kernel/riscv.h" target="_blank" rel="noreferrer">xv6 · kernel/riscv.h</a><a href="https://github.com/mit-pdos/xv6-riscv/blob/riscv/kernel/vm.c" target="_blank" rel="noreferrer">xv6 · kernel/vm.c</a><a href="https://pdos.csail.mit.edu/6.828/2025/xv6/book-riscv-rev5.pdf" target="_blank" rel="noreferrer">Libro oficial de xv6 · capítulo 3</a></footer>
  </article>`;
}

const help = {
  guide: `<h2>Tu primera traducción Sv39</h2><ol class="guide-list"><li><strong>Empezá por “Datos de usuario: lectura simple”.</strong> Presenta índice, destino y permisos con palabras, sin exponer la metadata binaria de las PTE.</li><li><strong>Después probá “Datos de usuario: escritura”.</strong> Separa cada corrimiento, máscara y reconstrucción del PPN en un paso propio.</li><li><strong>Separá la dirección.</strong> VPN[2], VPN[1] y VPN[0] tienen 9 bits cada uno; el offset tiene 12.</li><li><strong>Seguí una entrada por nivel.</strong> La dirección de cada entrada es <code>base + índice × 8</code>.</li><li><strong>Los demás ejemplos.</strong> Agregan un paso de metadata en cada nivel y muestran operandos, máscaras, PPN y resultado.</li><li><strong>Distinguí puntero y hoja.</strong> En niveles 2 y 1, V=1 y R=W=X=0 conducen a otra tabla. En nivel 0, R/W/X identifican la hoja.</li><li><strong>Recién al final validá U y el acceso.</strong> La dirección física conserva el offset original.</li></ol><div class="guide-tip">Probá los tres ejemplos “ausente”: la metadata muestra V=0 y el recorrido se corta exactamente en ese nivel.</div><p>Ampliá cualquier explicación con <kbd>Ctrl</kbd> + clic o con el botón de lupa; cerrá con <kbd>Esc</kbd>. Atajos fuera de controles: <kbd>→</kbd> siguiente · <kbd>←</kbd> anterior · <kbd>Espacio</kbd> reproducir o pausar.</p>`,
  theory: riscvTheoryContent(),
  about: `<h2>Cinco formas de traducir.</h2><p>Laboratorio educativo independiente para Sistemas Operativos, Ingeniería en Informática, FIUBA. Sin afiliación institucional.</p><p>Elegí Paginación x86 de 32 bits, Paginación con TLB, Segmentación, RISC-V/xv6 o Paginación x86-64. Cada simulación tiene estado, guía, fundamento y modelo propios.</p>`,
};
document.querySelectorAll('[data-rv-dialog]').forEach(button => button.addEventListener('click', () => {
  stop(); render();
  $('#rv-dialog-content').innerHTML = help[button.dataset.rvDialog];
  $('#rv-dialog').setAttribute('aria-label', button.textContent.trim());
  $('#rv-dialog').classList.toggle('rv-theory-dialog', button.dataset.rvDialog === 'theory');
  $('#rv-dialog').showModal();
  $('#rv-dialog').scrollTop = 0;
}));
$('#rv-close-dialog').addEventListener('click', () => $('#rv-dialog').close());
$('#rv-dialog').addEventListener('click', event => {
  if (event.target !== $('#rv-dialog')) return;
  const rect = event.target.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
});
document.addEventListener('keydown', event => {
  if (!trace || $('#rv-dialog').open || $('#rv-zoom').open || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY'].includes(document.activeElement.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'ArrowRight') { event.preventDefault(); stop(); move(step + 1); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); stop(); move(step - 1); }
  if (event.code === 'Space') { event.preventDefault(); play(); }
});
window.addEventListener('pagehide', stop);
bindSimulationMenu(stop);
start();
