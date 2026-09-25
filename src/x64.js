// Modelo didáctico de IA-32e: cuatro niveles, LA57=0, páginas de 4 KiB,
// MAXPHYADDR=52, EFER.NXE=1, CR0.WP=1 y soporte de páginas de 1 GiB.
// No simula TLB ni traduce páginas grandes.
export const X64_PAGE_SHIFT = 12n;
export const X64_PAGE_SIZE = 1n << X64_PAGE_SHIFT;
export const X64_INDEX_MASK = 0x1FFn;
export const X64_ENTRY_SIZE = 8n;
export const X64_ENTRY_COUNT = 512;
export const X64_ADDRESS_MASK = 0x000FFFFFFFFFF000n;
export const X64_MAX_VA = (1n << 64n) - 1n;
export const X64_ROOT = 0x0000000010000000n;
export const X64_CR3 = X64_ROOT;

export const X64_P = 1n << 0n;
export const X64_RW = 1n << 1n;
export const X64_US = 1n << 2n;
export const X64_PS = 1n << 7n;
export const X64_NX = 1n << 63n;

const accessNames = { read: 'lectura', write: 'escritura', execute: 'ejecución' };
const names = ['PML4', 'PDPT', 'PD', 'PT'];
export const x64LevelNames = [
  'Tabla de mapa de páginas de nivel 4',
  'Tabla de punteros a directorios de páginas',
  'Directorio de páginas',
  'Tabla de páginas',
];
const levelWithArticle = level => `${level === 2 ? 'el' : 'la'} ${x64LevelNames[level].toLowerCase()}`;
const shifts = [39n, 30n, 21n, 12n];

export function hexX64(value, width = 16) {
  return `0x${BigInt(value).toString(16).toUpperCase().padStart(width, '0')}`;
}

export function parseX64Address(value) {
  let address;
  if (typeof value === 'bigint') address = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) address = BigInt(value);
  else if (typeof value === 'string' && /^(?:0x)?[0-9a-f]{1,16}$/i.test(value.trim())) {
    const text = value.trim();
    address = BigInt(text.toLowerCase().startsWith('0x') ? text : `0x${text}`);
  } else throw new TypeError('Ingresá una dirección hexadecimal de hasta 64 bits.');
  if (address < 0n || address > X64_MAX_VA) throw new RangeError('La dirección debe estar entre 0 y 0xFFFFFFFFFFFFFFFF.');
  return address;
}

export function isCanonicalX64(value) {
  const address = parseX64Address(value);
  const sign = (address >> 47n) & 1n;
  return (address >> 48n) === (sign ? 0xFFFFn : 0n);
}

export function splitX64Address(value) {
  const address = parseX64Address(value);
  return {
    pml4: Number((address >> 39n) & X64_INDEX_MASK),
    pdpt: Number((address >> 30n) & X64_INDEX_MASK),
    pd: Number((address >> 21n) & X64_INDEX_MASK),
    pt: Number((address >> 12n) & X64_INDEX_MASK),
    offset: address & (X64_PAGE_SIZE - 1n),
  };
}

export function x64EntryAddress(tableBase, index) {
  if (!Number.isInteger(index) || index < 0 || index >= X64_ENTRY_COUNT) throw new RangeError('Índice de tabla inválido.');
  return BigInt(tableBase) + BigInt(index) * X64_ENTRY_SIZE;
}

export function x64EntryBase(entry) {
  return BigInt(entry) & X64_ADDRESS_MASK;
}

export function decodeX64Entry(entry) {
  const value = BigInt(entry);
  return {
    value,
    base: x64EntryBase(value),
    lowBits: value & 0xFFFn,
    flags: {
      P: Boolean(value & X64_P),
      RW: Boolean(value & X64_RW),
      US: Boolean(value & X64_US),
      B7: Boolean(value & X64_PS),
      NX: Boolean(value & X64_NX),
    },
  };
}

function makeEntry(base, { user = true, writable = true, nx = false } = {}) {
  const address = BigInt(base);
  if (address & 0xFFFn || address < 0n || address > X64_ADDRESS_MASK) throw new RangeError('Base física inválida.');
  return address | X64_P | (writable ? X64_RW : 0n) | (user ? X64_US : 0n) | (nx ? X64_NX : 0n);
}

export const X64_PDPT_LOW = 0x0000000010001000n;
export const X64_PD_LOW = 0x0000000010002000n;
export const X64_PT_LOW = 0x0000000010003000n;
export const X64_PDPT_HIGH = 0x0000000010004000n;
export const X64_PD_HIGH = 0x0000000010005000n;
export const X64_PT_HIGH = 0x0000000010006000n;

// Cada Map interno es una página de tabla física. Una entrada ausente es cero.
export const x64PageTables = new Map([
  [X64_ROOT, new Map([
    [0, makeEntry(X64_PDPT_LOW)],
    [256, makeEntry(X64_PDPT_HIGH, { user: false })],
  ])],
  [X64_PDPT_LOW, new Map([[0, makeEntry(X64_PD_LOW)]])],
  [X64_PD_LOW, new Map([[2, makeEntry(X64_PT_LOW)]])],
  [X64_PT_LOW, new Map([
    [3, makeEntry(0x000000002000A000n, { nx: true })],
    [4, makeEntry(0x000000002000B000n, { writable: false })],
    [5, makeEntry(0x000000002000C000n, { user: false, nx: true })],
  ])],
  [X64_PDPT_HIGH, new Map([[0, makeEntry(X64_PD_HIGH, { user: false })]])],
  [X64_PD_HIGH, new Map([[2, makeEntry(X64_PT_HIGH, { user: false })]])],
  [X64_PT_HIGH, new Map([[3, makeEntry(0x000000003000A000n, { user: false, nx: true })]])],
]);

export function readX64Entry(tableBase, index, model = x64PageTables) {
  x64EntryAddress(tableBase, index);
  return model.get(BigInt(tableBase))?.get(index) ?? 0n;
}

function entryFault(entry, level, access, mode) {
  if (!(entry & X64_P)) return { kind: 'not-present', exception: '#PF', message: `${x64LevelNames[level]}: P=0. La entrada no está presente; se genera #PF.` };
  if (level === 0 && entry & X64_PS) return { kind: 'reserved-bit', exception: '#PF', message: 'La entrada de la tabla de mapa de páginas de nivel 4 tiene un bit reservado activado; se genera #PF por bit reservado.' };
  if ((level === 1 || level === 2) && entry & X64_PS) {
    // Con PS=1, bit 12 pasa a ser PAT; los bits 29:13 (1 GiB) o
    // 20:13 (2 MiB) quedan reservados y deben valer cero.
    const pageShift = level === 1 ? 30n : 21n;
    const reserved = ((1n << pageShift) - 1n) & ~((1n << 13n) - 1n);
    if (entry & reserved) return { kind: 'reserved-bit', exception: '#PF', message: `${x64LevelNames[level]}: PS=1 pero hay bits reservados activos en la base de la página grande; se genera #PF.` };
    return { kind: 'large-page', exception: null, message: `${x64LevelNames[level]} describe una página grande válida de ${level === 1 ? '1 GiB' : '2 MiB'}; este laboratorio sólo recorre páginas de 4 KiB.` };
  }
  if (mode === 'user' && !(entry & X64_US)) return { kind: 'user-protection', exception: '#PF', message: `${x64LevelNames[level]}: U/S=0. Un acceso desde usuario se detiene con #PF.` };
  if (access === 'write' && !(entry & X64_RW)) return { kind: 'write-protection', exception: '#PF', message: `${x64LevelNames[level]}: R/W=0. Con CR0.WP=1 la escritura se detiene con #PF.` };
  if (access === 'execute' && entry & X64_NX) return { kind: 'execute-protection', exception: '#PF', message: `${x64LevelNames[level]}: NX=1. Con EFER.NXE=1 la ejecución se detiene con #PF.` };
  return null;
}

export function planX64Translation(value, { access = 'read', mode = 'user', model = x64PageTables, cr3 = X64_CR3, detailed = false, expanded = false } = {}) {
  if (!Object.hasOwn(accessNames, access)) throw new TypeError('Tipo de acceso inválido.');
  if (!['user', 'supervisor'].includes(mode)) throw new TypeError('Modo de acceso inválido.');
  const address = parseX64Address(value);
  const register = BigInt(cr3);
  const root = register & X64_ADDRESS_MASK;
  const indices = splitX64Address(address);
  const result = { address, access, mode, cr3: register, root, ...indices, detailed: Boolean(detailed || expanded), expanded: Boolean(expanded), reads: [], frame: null, physical: null, fault: null };
  const steps = [{ key: 'start', label: 'MMU y CR3', title: 'La MMU parte de CR3.', text: `CR3=${hexX64(register)} contiene la base física ${hexX64(root)} de ${levelWithArticle(0)}. En este ejercicio PCID=0.` }];

  if (!isCanonicalX64(address)) {
    result.fault = { kind: 'noncanonical', exception: '#GP', message: `La dirección ${hexX64(address)} no es canónica: los bits 63:48 no copian el bit 47. La CPU genera #GP antes de consultar ${levelWithArticle(0)}.` };
    steps.push({ key: 'canonical', label: 'Dirección canónica', title: 'La dirección se rechaza antes de paginar.', text: result.fault.message, fault: result.fault });
    return { ...result, steps };
  }

  steps.push({ key: 'split', label: 'Dirección lineal', title: 'Separamos cuatro índices y un offset.', text: `Los índices de los niveles 4, 3, 2 y 1 son ${indices.pml4}, ${indices.pdpt}, ${indices.pd} y ${indices.pt}; el offset es ${hexX64(indices.offset, 3)}. Cada índice ocupa 9 bits.` });
  if (expanded) {
    for (const [level, name] of names.entries()) {
      const shift = shifts[level];
      const shifted = address >> shift;
      const index = indices[name.toLowerCase()];
      steps.push({ key: `index-${name.toLowerCase()}`, label: `Índice nivel ${4 - level}`, title: `Extraemos el índice de ${levelWithArticle(level)}.`, text: `${hexX64(address)} >> ${shift} = ${hexX64(shifted)}; ${hexX64(shifted)} & 0x1FF = ${hexX64(BigInt(index), 3)} (${index}).`, phase: 'index', level, name, shift, shifted, index });
    }
    steps.push({ key: 'index-offset', label: 'Offset', title: 'Aislamos el offset de 12 bits.', text: `${hexX64(address)} & 0xFFF = ${hexX64(indices.offset, 3)}. Estos 12 bits se conservan en la dirección física.`, phase: 'offset' });
  }

  let tableBase = root;
  for (const [level, name] of names.entries()) {
    const index = indices[name.toLowerCase()];
    const entryAddress = x64EntryAddress(tableBase, index);
    const entry = readX64Entry(tableBase, index, model);
    const decoded = decodeX64Entry(entry);
    const fault = entryFault(entry, level, access, mode);
    const read = { level, name, index, key: `level-${name.toLowerCase()}`, tableBase, entryAddress, entry, decoded, nextBase: decoded.flags.P ? decoded.base : null, fault };
    result.reads.push(read);
    steps.push({ key: read.key, label: x64LevelNames[level], title: result.detailed ? `Ubicamos la entrada [${index}] de ${levelWithArticle(level)} en memoria física.` : fault ? `El recorrido se detiene en ${levelWithArticle(level)}.` : `La entrada [${index}] ${level === 3 ? 'selecciona el marco' : `conduce a ${levelWithArticle(level + 1)}`}.`, text: result.detailed ? `${hexX64(tableBase)} + ${index} × 8 = ${hexX64(entryAddress)}; Mem[${hexX64(entryAddress)}] = ${hexX64(entry)}.` : fault?.message ?? `${hexX64(tableBase)} + ${index} × 8 = ${hexX64(entryAddress)}; la entrada apunta a ${hexX64(decoded.base)}.`, read, fault: result.detailed ? null : fault, phase: 'lookup' });
    if (result.detailed) {
      steps.push({ key: `${read.key}-flags`, label: `Flags nivel ${4 - level}`, title: fault ? `La entrada de ${levelWithArticle(level)} detiene el recorrido.` : `Interpretamos permisos y presencia en ${levelWithArticle(level)}.`, text: fault?.message ?? `P=${Number(decoded.flags.P)}, R/W=${Number(decoded.flags.RW)}, U/S=${Number(decoded.flags.US)}, NX=${Number(decoded.flags.NX)}. Los bits físicos [51:12] forman ${hexX64(decoded.base)}.`, read, fault, phase: 'flags' });
      if (!fault) steps.push({ key: `${read.key}-base`, label: `Base nivel ${4 - level}`, title: level === 3 ? 'Extraemos el marco físico.' : `Extraemos la base física de ${levelWithArticle(level + 1)}.`, text: `${hexX64(entry)} & 0x000FFFFFFFFFF000 = ${hexX64(decoded.base)}. La máscara descarta flags y NX sin desplazar la base.`, read, phase: 'base' });
    }
    if (fault) { result.fault = { ...fault, level, name }; return { ...result, steps }; }
    tableBase = decoded.base;
  }

  steps.push({ key: 'permissions', label: 'Permisos', title: 'Los cuatro niveles autorizaron el acceso.', text: `Todas las entradas tienen P=1; ${mode === 'user' ? 'U/S=1 en cada nivel; ' : 'el acceso es de supervisor; '}${access === 'write' ? 'R/W=1 en cada nivel' : access === 'execute' ? 'NX=0 en cada nivel' : 'la lectura no requiere un bit R separado'}.` });
  result.frame = result.reads[3].decoded.base;
  result.physical = result.frame + indices.offset;
  steps.push({ key: 'physical', label: 'Dirección física', title: 'El offset se suma al marco de 4 KiB.', text: `${hexX64(result.frame)} + ${hexX64(indices.offset, 3)} = ${hexX64(result.physical)}.`, physical: result.physical });
  return { ...result, steps };
}

export const x64Examples = [
  { name: 'Datos de usuario: lectura simple', address: '0x0000000000403010', access: 'read', mode: 'user' },
  { name: 'Datos de usuario: escritura detallada', address: '0x0000000000403010', access: 'write', mode: 'user' },
  { name: 'Código de usuario: ejecución', address: '0x0000000000404120', access: 'execute', mode: 'user' },
  { name: 'Código: escritura prohibida', address: '0x0000000000404120', access: 'write', mode: 'user' },
  { name: 'Datos: ejecución prohibida por NX', address: '0x0000000000403010', access: 'execute', mode: 'user' },
  { name: 'Hoja de supervisor: usuario denegado', address: '0x0000000000405040', access: 'read', mode: 'user' },
  { name: 'Hoja ausente: tabla de páginas', address: '0x0000000000406000', access: 'read', mode: 'user' },
  { name: 'Tabla ausente: directorio de páginas', address: '0x0000000000600000', access: 'read', mode: 'user' },
  { name: 'Tabla ausente: punteros a directorios', address: '0x0000000040000000', access: 'read', mode: 'user' },
  { name: 'Raíz ausente: mapa de páginas', address: '0x0000008000000000', access: 'read', mode: 'user' },
  { name: 'Mitad superior: supervisor', address: '0xFFFF800000403010', access: 'read', mode: 'supervisor' },
  { name: 'Dirección no canónica: #GP', address: '0x0000800000000000', access: 'read', mode: 'user' },
];
