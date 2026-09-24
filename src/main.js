// Cada laboratorio tiene su propio estado y controladores; nunca se montan juntos.
const simulation = new URLSearchParams(window.location.search).get('sim');
if (simulation === 'tlb') {
  await import('./tlb-app.js');
} else if (simulation === 'segmentation') {
  await import('./segmentation-app.js');
} else if (simulation === 'riscv') {
  await import('./riscv-app.js');
} else {
  await import('./app.js');
}
