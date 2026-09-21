// Cada laboratorio tiene su propio estado y controladores; nunca se montan juntos.
if (new URLSearchParams(window.location.search).get('sim') === 'tlb') {
  await import('./tlb-app.js');
} else {
  await import('./app.js');
}
