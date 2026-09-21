import { CR3, flags, hex, memory, splitAddress, translate } from './memory.js';

// Modelo didáctico: una TLB unificada, totalmente asociativa y FIFO.
// Contexto único, CR3 fijo; no se modelan PCID, globales ni cambios de tablas.
export function createTlb(capacity = 4) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 16) throw new RangeError('Capacidad TLB inválida.');
  return { capacity, entries: [] };
}
const copy = tlb => ({ capacity: tlb.capacity, entries: tlb.entries.map(entry => ({ ...entry })) });

export function planTlbTranslation(address, { tlb = createTlb(), access = 'read', mode = 'user', model = memory } = {}) {
  if (!['read', 'write'].includes(access) || !['user', 'supervisor'].includes(mode)) throw new TypeError('Acceso o modo inválido.');
  const parts = splitAddress(address);
  const vpn = address >>> 12;
  const before = copy(tlb);
  let cache = copy(before);
  const cached = cache.entries.find(entry => entry.vpn === vpn);
  const hit = Boolean(cached);
  const steps = [];
  let reads = 0;
  let walk = {};
  let outcome = null;
  const add = (key, label, title, text, extra = {}) => {
    steps.push({ key, label, title, text, reads, walk: { ...walk }, tlb: copy(cache), physical: null, fault: null, ...extra });
  };
  add('start', 'MMU y CR3', 'La traducción empieza en la MMU.', `La MMU recibe ${hex(address)} y tiene disponible CR3=${hex(CR3)}. Primero consultará la TLB; sólo usará CR3 si ocurre un miss.`);
  add('lookup', 'Consultar TLB', hit ? '¡Hit! La traducción ya está guardada.' : 'Miss: todavía no está en la TLB.', hit
    ? `La página ${hex(vpn, 5)} coincide con una entrada. No hace falta leer PDE ni PTE; todavía hay que comprobar sus permisos.`
    : `No hay una entrada para ${hex(vpn, 5)}. Esto no es un page fault: la MMU buscará la traducción en las tablas.`);

  if (hit) {
    let message = null;
    if (mode === 'user' && !cached.user) message = 'La entrada TLB tiene U/S=0: este acceso requiere modo supervisor.';
    else if (access === 'write' && !cached.writable) message = 'La entrada TLB tiene R/W=0: no permite escribir, incluso en supervisor (CR0.WP=1).';
    outcome = message ? { kind: 'protection', message } : null;
    add('permissions', 'Permisos', outcome ? 'Hit no significa permiso.' : 'Los permisos permiten este acceso.', message
      ? `${message} Se genera #PF y no se accede al byte. No se recorren las tablas.`
      : 'La TLB conserva los permisos efectivos de PDE y PTE. Se comprueban antes de acceder al byte.', { fault: outcome, frameBase: cached.frameBase });
  } else {
    const result = translate(address, { access, mode, model });
    walk = { directoryBase: result.directoryBase };
    reads = 1;
    walk = { ...walk, pde: result.pde, pdeAddress: result.pdeAddress };
    if (result.fault?.stage === 2) {
      outcome = result.fault;
      add('directory', 'Page Directory', 'La PDE no está presente: #PF.', `CR3=${hex(CR3)} carga el Page Directory. ${outcome.message} No se lee una PTE ni se incorpora una traducción a la TLB.`, { fault: outcome });
    } else {
      walk.tableBase = result.tableBase;
      add('directory', 'Page Directory', `Cargamos Page Directory y leemos PDE[${parts.pdi}].`, `CR3=${hex(CR3)} da su base. ${hex(result.directoryBase)} + ${parts.pdi} × 4 = ${hex(result.pdeAddress)}. PDE=${hex(result.pde)}; base de la tabla=${hex(result.tableBase)}.`);
      reads = 2;
      walk = { ...walk, pte: result.pte, pteAddress: result.pteAddress };
      outcome = result.fault;
      if (outcome) {
        add('table', 'Page Table', 'El recorrido termina en #PF.', `${outcome.message} En este modelo no se incorpora la traducción fallida a la TLB ni se accede al byte.`, { fault: outcome });
      } else {
        walk.frameBase = result.frameBase;
        add('table', 'Page Table', `Cargamos Page Table y leemos PTE[${parts.pti}].`, `${hex(result.tableBase)} + ${parts.pti} × 4 = ${hex(result.pteAddress)}. PTE=${hex(result.pte)}; marco=${hex(result.frameBase)}. El acceso está permitido.`);
        const pdeFlags = flags(result.pde), pteFlags = flags(result.pte);
        const evicted = cache.entries.length === cache.capacity ? cache.entries.shift() : null;
        cache.entries.push({ vpn, frameBase: result.frameBase, writable: pdeFlags.writable && pteFlags.writable, user: pdeFlags.user && pteFlags.user });
        add('fill', 'Cargar TLB', 'Guardamos la traducción, no el byte.', `VPN=${hex(vpn, 5)} → marco=${hex(result.frameBase)}, junto con R/W y U/S efectivos.${evicted ? ` Sale VPN=${hex(evicted.vpn, 5)}, la entrada más antigua (FIFO didáctico).` : ' El próximo acceso a esta página podrá ser un hit.'}`, { evicted });
      }
    }
  }
  if (!outcome) {
    const entry = cache.entries.find(item => item.vpn === vpn);
    add('physical', 'Memoria física', 'Ubicamos la dirección en el Address Space físico.', `${hex(entry.frameBase)} + ${hex(parts.offset, 3)} = ${hex(entry.frameBase + parts.offset)}. El offset no cambia. ${reads} lecturas de tablas para esta traducción; no se cuentan cachés de datos ni ciclos reales.`, { frameBase: entry.frameBase, physical: entry.frameBase + parts.offset });
  }
  return { address, vpn, ...parts, access, mode, hit, before, after: copy(cache), steps };
}

// Las precargas son ejemplos preparados, no consultas ocultas de la UI.
export function preloadTlb(addresses, options = {}) {
  return addresses.reduce((tlb, address) => planTlbTranslation(address, { ...options, tlb }).after, createTlb());
}
