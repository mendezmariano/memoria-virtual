export const PAGE_SHIFT = 12n;
export const PAGE_SIZE = 1n << PAGE_SHIFT;
export const VPN_BITS = 9n;
export const VPN_MASK = 0x1FFn;
export const PTE_SIZE = 8n;
export const PTE_COUNT = 512;

// xv6 usa Sv39, pero limita walk() a la mitad inferior para no tener que
// sign-extend bit 38. MAXVA es exclusivo, igual que en kernel/riscv.h.
export const MAXVA = 1n << 38n;
export const ROOT_TABLE = 0x0000000087FFF000n;
export const SATP = (8n << 60n) | (ROOT_TABLE >> PAGE_SHIFT);

export const PTE_V = 1n << 0n;
export const PTE_R = 1n << 1n;
export const PTE_W = 1n << 2n;
export const PTE_X = 1n << 3n;
export const PTE_U = 1n << 4n;
export const PTE_G = 1n << 5n;
export const PTE_A = 1n << 6n;
export const PTE_D = 1n << 7n;

const PPN_MASK = (1n << 44n) - 1n;
const LEAF_MASK = PTE_R | PTE_W | PTE_X;
const accessNames = { read: 'lectura', write: 'escritura', execute: 'ejecución' };

export function hexRiscv(value, width = 16) {
  return `0x${BigInt(value).toString(16).toUpperCase().padStart(width, '0')}`;
}

export function parseRiscvAddress(value) {
  let address;
  if (typeof value === 'bigint') {
    address = value;
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    address = BigInt(value);
  } else if (typeof value === 'string' && /^(?:0x)?[0-9a-f]+$/i.test(value.trim())) {
    const text = value.trim();
    address = BigInt(text.toLowerCase().startsWith('0x') ? text : `0x${text}`);
  } else {
    throw new TypeError('Ingresá una dirección hexadecimal válida.');
  }

  if (address < 0n || address >= MAXVA) {
    throw new RangeError(`xv6 admite direcciones desde ${hexRiscv(0n)} hasta ${hexRiscv(MAXVA - 1n)}.`);
  }
  return address;
}

export function splitSv39Address(value) {
  const address = parseRiscvAddress(value);
  return {
    vpn2: Number((address >> 30n) & VPN_MASK),
    vpn1: Number((address >> 21n) & VPN_MASK),
    vpn0: Number((address >> 12n) & VPN_MASK),
    offset: address & (PAGE_SIZE - 1n),
  };
}

export function paToPte(physicalAddress) {
  return ((BigInt(physicalAddress) >> PAGE_SHIFT) & PPN_MASK) << 10n;
}

export function pteToPa(pte) {
  return ((BigInt(pte) >> 10n) & PPN_MASK) << PAGE_SHIFT;
}

export function decodeRiscvPte(pte) {
  const value = BigInt(pte);
  return {
    value,
    metadata: value & 0x3FFn,
    ppn: (value >> 10n) & PPN_MASK,
    rsw: Number((value >> 8n) & 0x3n),
    flags: {
      V: Boolean(value & PTE_V),
      R: Boolean(value & PTE_R),
      W: Boolean(value & PTE_W),
      X: Boolean(value & PTE_X),
      U: Boolean(value & PTE_U),
      G: Boolean(value & PTE_G),
      A: Boolean(value & PTE_A),
      D: Boolean(value & PTE_D),
    },
  };
}

export function satpRoot(satp = SATP) {
  const value = BigInt(satp);
  const mode = Number((value >> 60n) & 0xFn);
  if (mode !== 8) throw new RangeError('satp debe seleccionar el modo Sv39 (MODE=8).');
  return (value & PPN_MASK) << PAGE_SHIFT;
}

export function pteFlagCode(pte) {
  const value = BigInt(pte);
  return [
    [PTE_D, 'D'], [PTE_A, 'A'], [PTE_G, 'G'], [PTE_U, 'U'],
    [PTE_X, 'X'], [PTE_W, 'W'], [PTE_R, 'R'], [PTE_V, 'V'],
  ].map(([mask, name]) => value & mask ? name : '-').join('');
}

const tablePte = physicalAddress => paToPte(physicalAddress) | PTE_V;
const leafPte = (physicalAddress, flags) => paToPte(physicalAddress) | flags | PTE_V;

export const L1_LOW = 0x0000000087FFE000n;
export const L0_LOW = 0x0000000087FFD000n;
export const L1_HIGH = 0x0000000087FFC000n;
export const L0_HIGH = 0x0000000087FFB000n;

// Mapa fijo y disperso: cada Map representa una página de tabla alojada en
// memoria física. Una entrada ausente vale cero; nunca se crea para acomodar
// la dirección ingresada.
export const riscvPageTables = new Map([
  [ROOT_TABLE, new Map([
    [0, tablePte(L1_LOW)],
    [255, tablePte(L1_HIGH)],
  ])],
  [L1_LOW, new Map([
    [2, tablePte(L0_LOW)],
  ])],
  [L0_LOW, new Map([
    [3, leafPte(0x000000008020A000n, PTE_R | PTE_W | PTE_U | PTE_A | PTE_D)],
    [4, leafPte(0x000000008020B000n, PTE_R | PTE_X | PTE_U | PTE_A)],
    [5, leafPte(0x000000008020C000n, PTE_R | PTE_W | PTE_A | PTE_D)],
  ])],
  [L1_HIGH, new Map([
    [511, tablePte(L0_HIGH)],
  ])],
  [L0_HIGH, new Map([
    // TRAMPOLINE=MAXVA-PGSIZE en xv6. No lleva PTE_U: sólo supervisor.
    [511, leafPte(0x0000000080007000n, PTE_R | PTE_X | PTE_A)],
  ])],
]);

export function readRiscvPte(tableBase, index, model = riscvPageTables) {
  if (!Number.isInteger(index) || index < 0 || index >= PTE_COUNT) throw new RangeError('Índice de PTE inválido.');
  return model.get(BigInt(tableBase))?.get(index) ?? 0n;
}

function permissionFault(pte, access) {
  if (!(pte & PTE_U)) return 'La hoja no tiene PTE_U: una instrucción en modo usuario no puede accederla.';
  const required = { read: PTE_R, write: PTE_W, execute: PTE_X }[access];
  if (!(pte & required)) return `La hoja no permite ${accessNames[access]}: flags ${pteFlagCode(pte)}.`;
  return null;
}

export function planRiscvTranslation(value, { access = 'read', model = riscvPageTables, satp = SATP, detailed = false, expanded = false } = {}) {
  if (!Object.hasOwn(accessNames, access)) throw new TypeError('Tipo de acceso inválido.');
  const address = parseRiscvAddress(value);
  const root = satpRoot(satp);
  const indices = splitSv39Address(address);
  const result = {
    address,
    access,
    satp: BigInt(satp),
    detailed: Boolean(detailed || expanded),
    expanded: Boolean(expanded),
    root,
    ...indices,
    reads: [],
    frame: null,
    physical: null,
    fault: null,
  };
  const steps = [
    {
      key: 'start', label: 'MMU y satp', title: 'La traducción empieza en la MMU.',
      text: `satp=${hexRiscv(satp)} selecciona Sv39 y la raíz física ${hexRiscv(root)}.`,
    },
    {
      key: 'split', label: 'Dirección virtual', title: 'Sv39 separa tres índices y un offset.',
      text: `VPN[2]=${indices.vpn2}, VPN[1]=${indices.vpn1}, VPN[0]=${indices.vpn0} y offset=${hexRiscv(indices.offset, 3)}. xv6 exige VA < MAXVA.`,
    },
  ];

  if (expanded) {
    for (const { name, shift, index } of [
      { name: 'VPN[2]', shift: 30n, index: indices.vpn2 },
      { name: 'VPN[1]', shift: 21n, index: indices.vpn1 },
      { name: 'VPN[0]', shift: 12n, index: indices.vpn0 },
    ]) {
      const shifted = address >> shift;
      steps.push({
        key: `index-vpn${(shift - 12n) / 9n}`,
        label: name,
        title: `Extraemos ${name}: primero corrimiento, después máscara.`,
        text: `${hexRiscv(address)} >> ${shift} = ${hexRiscv(shifted)}. Luego ${hexRiscv(shifted)} & 0x1FF = ${hexRiscv(BigInt(index), 3)} (${index}). El corrimiento descarta los bits inferiores; la máscara conserva sólo 9 bits.`,
        phase: 'index', name, shift, shifted, index,
      });
    }
    steps.push({
      key: 'index-offset', label: 'Offset', title: 'Aislamos los 12 bits del offset.',
      text: `${hexRiscv(address)} & 0xFFF = ${hexRiscv(indices.offset, 3)}. No se desplaza: estos bits ya están en las posiciones [11:0] y permanecen iguales en la dirección física.`,
      phase: 'offset',
    });
  }

  const levels = [
    { level: 2, index: indices.vpn2, key: 'level2', label: 'Nivel 2 · raíz' },
    { level: 1, index: indices.vpn1, key: 'level1', label: 'Nivel 1' },
    { level: 0, index: indices.vpn0, key: 'level0', label: 'Nivel 0 · hoja' },
  ];
  let tableBase = root;

  for (const item of levels) {
    const pteAddress = tableBase + BigInt(item.index) * PTE_SIZE;
    const pte = readRiscvPte(tableBase, item.index, model);
    const valid = Boolean(pte & PTE_V);
    const leaf = Boolean(pte & LEAF_MASK);
    const nextBase = valid ? pteToPa(pte) : null;
    const decoded = decodeRiscvPte(pte);
    const read = { ...item, tableBase, pteAddress, pte, valid, leaf, nextBase, decoded };
    result.reads.push(read);

    let fault = null;
    if (!valid) {
      fault = {
        kind: 'not-present', level: item.level,
        message: `PTE[${item.index}]=0: V=0 en el nivel ${item.level}. El hardware genera page fault.`,
      };
    } else if (item.level > 0 && leaf) {
      fault = {
        kind: 'superpage', level: item.level,
        message: `La PTE del nivel ${item.level} es hoja. Sv39 admite superpáginas, pero walk() de xv6 sólo construye hojas en nivel 0 en este recorrido.`,
      };
    } else if (item.level === 0 && (!leaf || (pte & PTE_W && !(pte & PTE_R)))) {
      fault = {
        kind: 'invalid-leaf', level: 0,
        message: `La PTE del nivel 0 no es una hoja Sv39 válida. El hardware genera page fault.`,
      };
    }

    const lookupStep = {
      key: item.key,
      label: item.label,
      title: result.detailed ? `Calculamos dónde está PTE[${item.index}] del nivel ${item.level}.` : fault ? `El recorrido se detiene en el nivel ${item.level}.` : item.level ? `PTE[${item.index}] conduce al nivel ${item.level - 1}.` : `PTE[${item.index}] es la hoja final.`,
      text: result.detailed
        ? `La tabla empieza en ${hexRiscv(tableBase)}. El índice ${item.index} desplaza ${item.index} × 8 bytes y ubica la entrada en ${hexRiscv(pteAddress)}; allí se lee ${hexRiscv(pte)}.`
        : fault?.message ?? `${hexRiscv(tableBase)} + ${item.index} × 8 = ${hexRiscv(pteAddress)}; PTE=${hexRiscv(pte)} (${pteFlagCode(pte)}).${item.level ? ` PTE2PA=${hexRiscv(nextBase)}.` : ''}`,
      fault: result.detailed ? null : fault,
      read,
      phase: 'lookup',
    };
    steps.push(lookupStep);

    if (result.detailed) {
      const rswBits = decoded.rsw.toString(2).padStart(2, '0');
      steps.push({
        key: `${item.key}-metadata`,
        label: `Metadata L${item.level}`,
        title: fault
          ? `La metadata detiene el recorrido en el nivel ${item.level}.`
          : item.level
            ? `La metadata identifica un puntero al nivel ${item.level - 1}.`
            : 'La metadata identifica la hoja final.',
        text: fault?.message ?? (expanded
          ? `PTE & 0x3FF = ${hexRiscv(decoded.metadata, 3)}. En orden real [9:0]: RSW[1:0]=${rswBits}, DAGUXWRV=${pteFlagCode(pte)}. ${item.level ? 'V=1 y R=W=X=0: es un puntero a otra tabla.' : 'V=1 y hay permisos R/W/X: es una hoja.'}`
          : `Los 10 bits bajos valen ${hexRiscv(decoded.metadata, 3)}. En orden real [9:0]: RSW[1:0]=${rswBits}, DAGUXWRV=${pteFlagCode(pte)}. El PPN vale ${hexRiscv(decoded.ppn)} y reconstruye ${hexRiscv(nextBase)}.`),
        fault,
        read,
        phase: 'metadata',
      });
      if (expanded && !fault) {
        steps.push({
          key: `${item.key}-ppn`,
          label: `PPN L${item.level}`,
          title: `Reconstruimos ${item.level ? 'la base de la tabla siguiente' : 'el marco físico'} desde la PTE.`,
          text: `${hexRiscv(pte)} >> 10 = ${hexRiscv(pte >> 10n)}; al aplicar & 0xFFFFFFFFFFF queda el PPN ${hexRiscv(decoded.ppn)}. Finalmente ${hexRiscv(decoded.ppn)} << 12 = ${hexRiscv(nextBase)}.`,
          read,
          phase: 'ppn',
        });
      }
    }

    if (fault) {
      result.fault = fault;
      return { ...result, steps };
    }
    tableBase = nextBase;
  }

  const leaf = result.reads[2].pte;
  const denied = permissionFault(leaf, access);
  if (denied) result.fault = { kind: 'protection', level: 0, message: denied };
  steps.push({
    key: 'permissions', label: 'Permisos',
    title: denied ? 'La MMU rechaza el acceso de usuario.' : 'La hoja autoriza el acceso.',
    text: denied ?? `PTE_U=1 y PTE_${{ read: 'R', write: 'W', execute: 'X' }[access]}=1: la ${accessNames[access]} puede continuar.`,
    fault: result.fault,
  });
  if (result.fault) return { ...result, steps };

  result.frame = pteToPa(leaf);
  result.physical = result.frame + indices.offset;
  steps.push({
    key: 'physical', label: 'Dirección física', title: 'El offset llega intacto al marco físico.',
    text: `${hexRiscv(result.frame)} + ${hexRiscv(indices.offset, 3)} = ${hexRiscv(result.physical)}.`,
    physical: result.physical,
  });
  return { ...result, steps };
}

export const riscvExamples = [
  { name: 'Datos de usuario: lectura simple', address: '0x0000000000403010', access: 'read' },
  { name: 'Datos de usuario: escritura', address: '0x0000000000403010', access: 'write' },
  { name: 'Código de usuario: ejecución', address: '0x0000000000404120', access: 'execute' },
  { name: 'Código: escritura prohibida', address: '0x0000000000404120', access: 'write' },
  { name: 'Guard page: U=0', address: '0x0000000000405040', access: 'read' },
  { name: 'Hoja ausente: nivel 0', address: '0x0000000000406000', access: 'read' },
  { name: 'Tabla ausente: nivel 1', address: '0x0000000000600000', access: 'read' },
  { name: 'Raíz ausente: nivel 2', address: '0x0000000040000000', access: 'read' },
  { name: 'TRAMPOLINE: sólo supervisor', address: '0x0000003FFFFFF000', access: 'execute' },
];
