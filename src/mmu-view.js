export function mmuIllustration() {
  return `<svg class="cpu-drawing" viewBox="0 0 180 128" role="img" aria-label="Procesador con su unidad de gestión de memoria"><g stroke="#29272c" stroke-width="2.5" stroke-linejoin="round"><path d="M42 19v-9h10v9m15 0v-9h10v9m15 0v-9h10v9m15 0v-9h10v9M42 104v13h10v-13m15 0v13h10v-13m15 0v13h10v-13m15 0v13h10v-13M29 34H16v10h13m0 13H16v10h13m0 13H16v10h13m121-56h13v10h-13m0 13h13v10h-13m0 13h13v10h-13" fill="#ffe05a"/><path d="m29 21 113-4 8 8v77l-8 8-111-3-5-8z" fill="#69758f"/><path d="m37 26 103-2v73l-104 1z" fill="#b7c2d4"/><rect x="50" y="38" width="77" height="49" rx="5" fill="#eee9dc"/><path d="m34 98-8 9m114-10 8 9M36 27l-7-6" fill="none"/><path d="M59 48h13m-13 7h6" stroke="#fff"/></g><text x="89" y="69" text-anchor="middle" font-size="27" font-weight="900" fill="#29272c" font-family="sans-serif">MMU</text></svg>`;
}

export function mmuStartContent({ register, value, footnote, focus = false, registerClass = '' }) {
  const classes = ['cr3-box', registerClass, focus ? 'focus-ring' : ''].filter(Boolean).join(' ');
  return `<span class="node-eyebrow">EL PUNTO DE PARTIDA</span>${mmuIllustration()}<h3>Todo empieza en la CPU</h3><p>La MMU hace la traducción.</p><div class="${classes}"><span>${register}</span><code>${value}</code></div><span class="node-footnote">${footnote}</span>`;
}
