import { hex } from './memory.js';

export const STBR = 0x00008000;
export const SEGMENT_BITS = 2;
export const OFFSET_BITS = 30;
export const SEGMENT_ENTRY_SIZE = 16;
export const OFFSET_MASK = 0x3FFFFFFF;

const permissions = (read, write, execute) => ({ read, write, execute });

// Cuatro regiones lógicas. Cada segmento ocupa un bloque físico contiguo,
// pero las bases están separadas: los huecos no se asignan implícitamente.
export const segmentTable = new Map([
  [0, { name: 'Código', base: 0x00100000, bound: 0x00018000, permissions: permissions(true, false, true), tone: 'blue' }],
  [1, { name: 'Datos', base: 0x00400000, bound: 0x00010000, permissions: permissions(true, true, false), tone: 'orange' }],
  [2, { name: 'Heap', base: 0x00800000, bound: 0x00020000, permissions: permissions(true, true, false), tone: 'green' }],
  [3, { name: 'Stack', base: 0x00C00000, bound: 0x00010000, permissions: permissions(true, true, false), tone: 'purple' }],
]);

function validateAddress(address) {
  if (!Number.isInteger(address) || address < 0 || address > 0xFFFFFFFF) throw new RangeError('La dirección debe tener 32 bits.');
}

export function splitSegmentAddress(address) {
  validateAddress(address);
  return { segment: address >>> OFFSET_BITS, offset: address & OFFSET_MASK };
}

export function permissionCode(descriptor) {
  if (!descriptor) return '---';
  return `${descriptor.permissions.read ? 'R' : '-'}${descriptor.permissions.write ? 'W' : '-'}${descriptor.permissions.execute ? 'X' : '-'}`;
}

export function planSegmentTranslation(address, { access = 'read', model = segmentTable, stbr = STBR } = {}) {
  if (!['read', 'write', 'execute'].includes(access)) throw new TypeError('Tipo de acceso inválido.');
  validateAddress(address);
  if (!Number.isInteger(stbr) || stbr < 0 || stbr > 0xFFFFFFFF) throw new RangeError('STBR inválido.');

  const { segment, offset } = splitSegmentAddress(address);
  const tableBase = stbr >>> 0;
  const entryAddress = tableBase + segment * SEGMENT_ENTRY_SIZE;
  const descriptor = model.get(segment) ?? null;
  const result = {
    address,
    segment,
    offset,
    access,
    tableBase,
    entryAddress,
    descriptor,
    withinBound: false,
    permitted: false,
    physical: null,
    fault: null,
  };

  const steps = [
    { key: 'start', label: 'MMU y STBR', title: 'La traducción empieza en la MMU.', text: `La MMU recibe ${hex(address)}. STBR=${hex(tableBase)} señala el inicio de la tabla de segmentos.` },
    { key: 'split', label: 'Dirección virtual', title: 'Separamos segmento y offset.', text: `Los ${SEGMENT_BITS} bits superiores seleccionan el segmento ${segment}; los ${OFFSET_BITS} restantes forman el offset ${hex(offset)}.` },
  ];

  if (!descriptor) {
    result.fault = { kind: 'not-present', message: `La entrada ${segment} no define un segmento. No se crea un mapeo para esta dirección.` };
    steps.push(
      { key: 'table', label: 'Tabla de segmentos', title: `Leemos la entrada ${segment}.`, text: `${hex(tableBase)} + ${segment} × ${SEGMENT_ENTRY_SIZE} = ${hex(entryAddress)}.` },
      { key: 'validate', label: 'Límite y permisos', title: 'La entrada no está presente: segmentation fault.', text: result.fault.message, fault: result.fault },
    );
    return { ...result, steps };
  }

  result.withinBound = offset < descriptor.bound;
  result.permitted = Boolean(descriptor.permissions[access]);
  steps.push({
    key: 'table',
    label: 'Tabla de segmentos',
    title: `La entrada ${segment} describe ${descriptor.name}.`,
    text: `${hex(tableBase)} + ${segment} × ${SEGMENT_ENTRY_SIZE} = ${hex(entryAddress)}. Base=${hex(descriptor.base)}, límite=${hex(descriptor.bound)} bytes, acceso=${permissionCode(descriptor)}.`,
  });

  if (!result.withinBound) {
    result.fault = { kind: 'limit', message: `El offset ${hex(offset)} no es menor que el límite ${hex(descriptor.bound)}. La dirección cae en un hueco virtual.` };
  } else if (!result.permitted) {
    const names = { read: 'lectura', write: 'escritura', execute: 'ejecución' };
    result.fault = { kind: 'protection', message: `El segmento ${descriptor.name} permite ${permissionCode(descriptor)}, no ${names[access]}.` };
  }

  steps.push({
    key: 'validate',
    label: 'Límite y permisos',
    title: result.fault ? 'La MMU detiene el acceso: segmentation fault.' : 'El offset y el acceso son válidos.',
    text: result.fault?.message ?? `${hex(offset)} < ${hex(descriptor.bound)} y ${access} está permitido por ${permissionCode(descriptor)}. Recién ahora se puede sumar la base.`,
    fault: result.fault,
  });

  if (!result.fault) {
    result.physical = descriptor.base + offset;
    steps.push({
      key: 'physical',
      label: 'Dirección física',
      title: 'Sumamos base + offset.',
      text: `${hex(descriptor.base)} + ${hex(offset)} = ${hex(result.physical)}. El segmento está contiguo en memoria física, aunque los demás pueden estar en otras ubicaciones.`,
      physical: result.physical,
    });
  }

  return { ...result, steps };
}

export const segmentationExamples = [
  { name: 'Datos: lectura válida', address: '0x400002A0', access: 'read' },
  { name: 'Código: ejecución válida', address: '0x00000120', access: 'execute' },
  { name: 'Heap: escritura válida', address: '0x80001000', access: 'write' },
  { name: 'Stack: último byte válido', address: '0xC000FFFF', access: 'read' },
  { name: 'Hueco: offset = límite', address: '0x40010000', access: 'read' },
  { name: 'Código: escritura prohibida', address: '0x00000120', access: 'write' },
  { name: 'Datos: ejecución prohibida', address: '0x400002A0', access: 'execute' },
  { name: 'Máxima dirección virtual', address: '0xFFFFFFFF', access: 'read' },
];
