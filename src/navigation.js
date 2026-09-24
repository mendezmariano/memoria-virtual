export function simulationMenu(mode) {
  return `<select id="simulation-menu" aria-label="Seleccionar simulación"><option value="paging" ${mode === 'paging' ? 'selected' : ''}>Paginación</option><option value="tlb" ${mode === 'tlb' ? 'selected' : ''}>Paginación con TLB</option><option value="segmentation" ${mode === 'segmentation' ? 'selected' : ''}>Segmentación</option><option value="riscv" ${mode === 'riscv' ? 'selected' : ''}>RISC-V · xv6</option></select>`;
}

export function bindSimulationMenu(stop) {
  document.querySelector('#simulation-menu').addEventListener('change', event => {
    stop();
    const url = new URL(window.location.href);
    if (event.target.value === 'tlb') url.searchParams.set('sim', 'tlb');
    else if (event.target.value === 'segmentation') url.searchParams.set('sim', 'segmentation');
    else if (event.target.value === 'riscv') url.searchParams.set('sim', 'riscv');
    else url.searchParams.delete('sim');
    url.hash = '';
    window.location.assign(url.href);
  });
}
