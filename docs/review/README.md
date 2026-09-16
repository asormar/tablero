# Revisión por fase

Cada fase del plan se cierra con una revisión independiente: **otro modelo, otro
contexto, sin memoria de cómo se hizo el trabajo**. El objetivo es encontrar lo
que el implementador no ve — y no dar por bueno nada sin evidencia de ejecución.

## Quién revisa

El comando de sesión `/review` lanza un subagente revisor por el raíl de
delegación, con las credenciales y el modelo que fija la configuración:

```yaml
auxiliary:
  review:
    provider: commandcode
    model: meta/muse-spark-1.3-contributor
```

Con `provider: auto` y `model: ""` el revisor usaría el mismo modelo de la
sesión; acá está fijado a uno distinto a propósito (el que implementa corre en
DeepSeek). Se cambia con `hermes config set auxiliary.review.model <modelo>`.

## Cómo se lanza

Al terminar una fase, en la sesión:

```
/review Revisá la fase <N> siguiendo el brief de docs/review/prompt.md.
        Alcance: git diff fase-<N-1>..HEAD en C:\Users\Alejandro\source\repos\tablero
```

El resultado vuelve a la sesión como una delegación normal. Se archiva en
`docs/review/fase-<N>.md` (junto con la fecha y el modelo que revisó) para que
quede el registro de qué se encontró y qué se hizo.

## El ciclo completo

1. **Cerrar la fase**: implementación + verificación propia (typecheck, tests,
   build, pruebas de aceptación ejecutadas de verdad).
2. **Etiquetar**: `git tag -a fase-<N> -m "Fase <N> terminada"` para que el
   revisor tenga un alcance limpio.
3. **Revisar**: `/review` con el brief de `docs/review/prompt.md`.
4. **Triar**: los bloqueantes se arreglan antes del commit de cierre; los
   importantes se arreglan o se anotan con motivo; los menores se anotan.
5. **Arreglar con contexto fresco**: los arreglos los aplica un agente distinto
   del que escribió (y del que revisó), acotado a lo que reportó el revisor.
6. **Reverificar**: los mismos comandos, con la salida real.
7. **Commit y push** del código + el informe de la revisión.

## Reglas

- El revisor **no modifica** el repositorio.
- Un hallazgo vale solo si trae `archivo:línea` y un arreglo concreto.
- Una decisión documentada en `ARCHITECTURE.md` no es un hallazgo.
- Si el revisor no puede verificar algo, debe decirlo; eso no se cuenta como
  verificado.

## Historial

| Fase | Informe | Modelo revisor | Veredicto |
| --- | --- | --- | --- |
| 1 | (pendiente de archivar) | meta/muse-spark-1.3-contributor | — |
