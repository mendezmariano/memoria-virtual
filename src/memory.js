// IA-32, paginación de dos niveles, no PAE, páginas de 4 KiB.
export const PAGE_SIZE = 4096;
export const CR3 = 0x00100000;
export const hex = (value, digits = 8) => '0x' + (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
export function parseAddress(input) {
  const text = input.trim();
  if (!/^(?:0x)?[0-9a-f]{1,8}$/i.test(text)) throw new Error('Ingresá de 1 a 8 dígitos hexadecimales, por ejemplo 0x00403010.');
  return Number.parseInt(text.replace(/^0x/i, ''), 16);
}
export function splitAddress(address) {
  if (!Number.isInteger(address) || address < 0 || address > 0xFFFFFFFF) throw new RangeError('La dirección debe tener 32 bits.');
  return { pdi: address >>> 22, pti: (address >>> 12) & 0x3FF, offset: address & 0xFFF };
}
export const memory = {
  directory: new Map([[0, 0x00101007], [1, 0x00123007], [768, 0x00124003], [1023, 0x00125007]]),
  tables: new Map([
    [0x00101000, new Map([[0, 0x00000007], [1, 0x00045007]])],
    [0x00123000, new Map([[0, 0x00080007], [1, 0x00091007], [2, 0x000A0007], [3, 0x000AB007], [4, 0x000C0005], [5, 0x000D0006]])],
    [0x00124000, new Map([[0, 0x00200003]])],
    [0x00125000, new Map([[1023, 0xFFFFF007]])],
  ]),
};
export function flags(entry) {
  return { present: Boolean(entry & 1), writable: Boolean(entry & 2), user: Boolean(entry & 4) };
}
export function translate(address, { access = 'read', mode = 'user', model = memory, cr3 = CR3 } = {}) {
  const parts = splitAddress(address);
  const directoryBase = (cr3 & 0xFFFFF000) >>> 0;
  const pdeAddress = directoryBase + parts.pdi * 4;
  const pde = model.directory.get(parts.pdi) ?? 0;
  const tableBase = (pde & 0xFFFFF000) >>> 0;
  const pteAddress = tableBase + parts.pti * 4;
  const pte = model.tables.get(tableBase)?.get(parts.pti) ?? 0;
  const frameBase = (pte & 0xFFFFF000) >>> 0;
  const result = { address, ...parts, directoryBase, pdeAddress, pde, tableBase, pteAddress, pte, frameBase, physical: null, fault: null };
  // P=0 terminates the walk. Permissions combine both levels; CR0.WP=1.
  const fail = (stage, kind, message) => ({ ...result, fault: { stage, kind, message } });
  if (!(pde & 1)) return fail(2, 'not-present', `La entrada PDE[${parts.pdi}] tiene P=0. No hay una tabla presente para esta región.`);
  if (!(pte & 1)) return fail(3, 'not-present', `La entrada PTE[${parts.pti}] tiene P=0. Esta página no está presente en memoria.`);
  if (mode === 'user' && (!(pde & 4) || !(pte & 4))) return fail(3, 'protection', 'U/S=0 en alguno de los niveles: esta página solo permite accesos del supervisor.');
  if (access === 'write' && (!(pde & 2) || !(pte & 2))) return fail(3, 'protection', 'R/W=0 en alguno de los niveles: no se permite escribir en esta página (CR0.WP=1).');
  return { ...result, physical: frameBase + parts.offset };
}
// Contenido sintético estable: no representa la memoria de la computadora anfitriona.
export const byteAt = address => ((address >>> 8) ^ address ^ 0x5A) & 0xFF;
export const examples = [
  { name: 'El recorrido clásico', address: '0x00403010', access: 'read', mode: 'user', note: 'Una página presente, lista para leer.' },
  { name: 'Otro byte, misma página', address: '0x00403FFF', access: 'read', mode: 'user', note: 'Cambia el offset; el marco sigue siendo el mismo.' },
  { name: 'Página no presente', address: '0x00405010', access: 'read', mode: 'user', note: 'Descubrí qué pasa cuando P vale 0.' },
  { name: 'Escritura no permitida', address: '0x00404020', access: 'write', mode: 'user', note: 'Una página de solo lectura recibe una escritura.' },
  { name: 'Memoria del kernel', address: '0xC0000010', access: 'read', mode: 'user', note: 'El acceso desde usuario requiere U/S=1 en ambos niveles.' },
  { name: 'El último byte', address: '0xFFFFFFFF', access: 'read', mode: 'user', note: 'Los 32 bits en 1: índices 1023 y offset 4095.' },
];
