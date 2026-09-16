# Brief de revisión por fase

Este es el documento que hay que darle al agente revisor. Está pensado para que un
**subagente independiente**, con otro modelo y sin contexto de cómo se hizo el
trabajo, audite una fase terminada y devuelva hallazgos accionables.

Cómo se lanza (dentro de la sesión, al cerrar una fase):

```
/review Revisá la fase <N> siguiendo el brief de docs/review/prompt.md.
        Alcance: git diff <fase N-1>..HEAD en C:\Users\Alejandro\source\repos\tablero
```

El revisor corre con el modelo configurado en `auxiliary.review`
(hoy `commandcode` / `meta/muse-spark-1.3-contributor`), distinto del que
implementa. Su resultado vuelve a la sesión como una delegación normal y se
archiva en `docs/review/fase-<N>.md`.

---

## Qué revisa

### 1. Cumplimiento del plan

- ¿Lo que hay implementado corresponde a lo que pide esa fase del plan maestro
  (secciones 1–14)? Listá lo que falta y lo que se hizo de más.
- ¿Se cumplen los **criterios de aceptación** de esa fase? Los criterios son
  verificables: si el plan dice «20 imágenes con progreso», hay que ejecutarlo,
  no inferirlo del código.
- ¿La interfaz se comporta como Milanote donde el plan no especifica detalle?

### 2. Verificación real, no declarada

- Ejecutá los comandos de verdad y pegá la salida: `pnpm -r typecheck`,
  `pnpm -r test`, `pnpm --filter @tablero/web build`, los scripts de humo
  (`apps/api/scripts/smoke-*.sh|ts`) y, cuando la fase toque interfaz, comprobá
  en un navegador real.
- **Desconfiá de cualquier afirmación sin evidencia**: comentarios que dicen
  «verificado», tests que no prueban el comportamiento, o documentación que
  describe algo que el código no hace.
- Si un criterio de aceptación no se puede ejecutar en el entorno, decilo
  explícitamente en vez de darlo por bueno.

### 3. Corrección y diseño

- **Invariantes del proyecto** (ver `ARCHITECTURE.md`): el dominio vive en
  `packages/shared` con tests; un gesto del usuario = una transacción Yjs = un
  paso de deshacer; la clave `text` de un elemento solo la escribe el editor;
  los documentos Yjs se clonan con ProseMirror JSON, no con actualizaciones
  binarias; un tablero local no puede ser el activo con servidor.
- Errores de lógica, condiciones invertidas, casos borde sin cubrir, carreras,
  fugas de recursos (listeners, timers, conexiones, object URLs), y estados de
  error que dejan la interfaz colgada.
- Coherencia entre capas: ¿la API valida lo que la web manda? ¿los tipos
  compartidos se usan en vez de duplicarse?

### 4. Seguridad

- Inyección (SQL, shell), XSS en el render de contenido subido o pegado,
  recorrido de rutas, SSRF en la previsualización de enlaces, validación de
  entradas externas con Zod, autorización por tablero/archivo (¿puede un
  usuario leer o borrar algo ajeno?), y secretos filtrados en el repositorio.
- Servicios de terceros incrustados: atributos `sandbox`/`allow` correctos.

### 5. Rendimiento

- ¿Se mantiene el criterio de la fase 1 (300 tarjetas a 60 fps, 0 re-renders de
  React por fotograma durante un arrastre)? ¿Las novedades (imágenes, visores,
  incrustados) se montan con pereza y no bloquean el lienzo?
- Virtualización intacta: no debe montarse lo que está fuera del viewport.
- Consultas N+1 o bucles de red por elemento.

### 6. Higiene

- Código muerto, `TODO` sin dueño, `console.log`, restos de depuración,
  dependencias innecesarias o sin límite de versión.
- Idiomas: interfaz y comentarios en español; identificadores en inglés.
- Tests: que prueben comportamiento (no la forma del código) y que fallen si se
  rompe la funcionalidad.

## Formato de la respuesta

Devolvé **solo** esto, en español y ordenado por severidad:

```markdown
# Revisión de la fase <N>

## Veredicto
<una o dos frases: ¿se puede dar la fase por cerrada?>

## Bloqueantes
- [archivo:línea] Qué está mal · Por qué importa · Cómo arreglarlo (concreto)

## Importantes
- [archivo:línea] …

## Menores
- [archivo:línea] …

## Lo que verifiqué con ejecución
<comandos y su resultado real, en una línea cada uno>

## Lo que no pude verificar
<y por qué>
```

## Reglas para el revisor

- **No modifiques el repositorio.** Solo leé, ejecutá comandos de verificación y
  reportá. Los arreglos los aplica otro agente después de que se decidan.
- Un hallazgo sin `archivo:línea` y sin arreglo concreto no sirve: no lo
  incluyas.
- Si algo te parece mal pero es una decisión documentada en `ARCHITECTURE.md`,
  no es un hallazgo: decilo en «Menores» como observación.
- No repitas el código en el informe; citá la línea.
- Si no encontrás bloqueantes, decilo con claridad en vez de inflar la lista.
