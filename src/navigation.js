export function simulationMenu(mode) {
  return `<select id="simulation-menu" aria-label="Seleccionar simulación"><option value="paging" ${mode === 'paging' ? 'selected' : ''}>Paginación</option><option value="tlb" ${mode === 'tlb' ? 'selected' : ''}>Paginación con TLB</option></select>`;
}

export function bindSimulationMenu(stop) {
  document.querySelector('#simulation-menu').addEventListener('change', event => {
    stop();
    const url = new URL(window.location.href);
    if (event.target.value === 'tlb') url.searchParams.set('sim', 'tlb');
    else url.searchParams.delete('sim');
    url.hash = '';
    window.location.assign(url.href);
  });
}
