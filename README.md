# Página a página — Memoria virtual

Simulador educativo de traducción de direcciones de 32 bits. Incluye tres recorridos paso a paso para estudiantes de Sistemas Operativos: Paginación, Paginación con TLB y Segmentación.

**Abrir el simulador:** https://mendezmariano.github.io/memoria-virtual/

Elegí el laboratorio desde el menú, ingresá una dirección hexadecimal, prepará un ejemplo y avanzá con Siguiente. Cada simulación tiene guía rápida y fundamento teórico propios.

Este repositorio contiene los archivos estáticos publicados con GitHub Pages desde la raíz de `main`. No requiere instalar dependencias ni ejecutar un servidor de aplicación. El archivo `.nojekyll` evita procesar los recursos con Jekyll.

Los laboratorios de paginación usan páginas de 4 KiB, bits 10/10/12, CR3 fijo, sin PAE ni páginas grandes; la variante con TLB modela cuatro entradas y reemplazo FIFO con fines didácticos. Segmentación divide la dirección en 2 bits de segmento y 30 de offset, con tabla fija, base, límite y permisos R/W/X. Toda la memoria es sintética: no se accede a la memoria del equipo.

Proyecto educativo independiente, sin afiliación institucional.
