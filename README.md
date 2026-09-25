# Página a página — Memoria virtual

Simulador educativo de traducción de direcciones para estudiantes de Sistemas Operativos. La publicación v1.4.0 incluye cinco recorridos paso a paso: Paginación x86, Paginación con TLB, Segmentación, RISC-V Sv39 según xv6 y Paginación x86-64.

**Abrir el simulador:** https://mendezmariano.github.io/memoria-virtual/

Elegí el laboratorio desde el menú, ingresá una dirección hexadecimal, prepará un ejemplo y avanzá con Siguiente. Cada simulación tiene guía rápida y fundamento teórico propios.

Este repositorio contiene los archivos estáticos publicados con GitHub Pages desde la raíz de `main`. No requiere instalar dependencias ni ejecutar un servidor de aplicación. El archivo `.nojekyll` evita procesar los recursos con Jekyll.

El laboratorio x86 de 32 bits usa páginas de 4 KiB, bits 10/10/12 y CR3 fijo, sin PAE ni páginas grandes; la variante con TLB modela cuatro entradas y reemplazo FIFO con fines didácticos. Segmentación divide la dirección en 2 bits de segmento y 30 de offset, con tabla fija, base, límite y permisos R/W/X. RISC-V/xv6 muestra los tres niveles 9/9/9 de Sv39 y PTE de 8 bytes. x86-64 muestra cuatro niveles de tablas, índices 9/9/9/9, offset de 12 bits y permisos P/RW/US/NX. Toda la memoria es sintética: no se accede a la memoria del equipo.

Proyecto educativo independiente, sin afiliación institucional.
