# Página a página — Memoria virtual

Simulador educativo de traducción de direcciones x86 de 32 bits, con paginación de dos niveles y páginas de 4 KiB. Recorrido paso a paso para estudiantes de Sistemas Operativos.

**Abrir el simulador:** https://mendezmariano.github.io/memoria-virtual/

Ingresá una dirección hexadecimal, elegí un ejemplo y avanzá con Siguiente. El menú Esquema teórico ofrece una ilustración del ejemplo inicial.

Este repositorio contiene los archivos estáticos publicados con GitHub Pages desde la raíz de `main`. No requiere instalar dependencias ni ejecutar un servidor de aplicación. El archivo `.nojekyll` evita procesar los recursos con Jekyll.

Páginas de 4 KiB, distribución de bits 10/10/12, segmentación plana, sin PAE ni páginas grandes. Memoria sintética y fija: no se accede a la memoria del equipo. Las escrituras solo comprueban permisos. No se modelan TLB, cachés ni bits A/D.

Proyecto educativo independiente, sin afiliación institucional.
