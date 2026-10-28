"""Lastre de memoria: reserva BALLAST_MB de RAM residente y duerme.

Oracle da por ociosa una instancia Always Free A1 si en 7 días el percentil 95
de CPU, la red y la memoria están todos por debajo del 20%. Mantener la memoria
por encima de ese umbral basta para que no lo sea. El coste en CPU es el de
rellenar las páginas una vez al arrancar; después el proceso duerme.

BALLAST_MB=0 desactiva el lastre (el proceso duerme sin reservar nada).
"""

import os
import signal
import sys

MIB = 1024 * 1024
# Margen por debajo del límite del contenedor para el propio intérprete.
HEADROOM_MB = 96


def cgroup_limit_mb():
    """Límite de memoria del cgroup en MiB, o None si no hay límite."""
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(path, encoding="ascii") as handle:
                raw = handle.read().strip()
        except OSError:
            continue
        if raw.isdigit() and int(raw) < (1 << 50):
            return int(raw) // MIB
    return None


def main():
    try:
        wanted = int(os.environ.get("BALLAST_MB", "3000"))
    except ValueError:
        print("BALLAST_MB no es un número entero: se usa 0", file=sys.stderr)
        wanted = 0
    wanted = max(wanted, 0)

    limit = cgroup_limit_mb()
    if limit is not None and wanted > limit - HEADROOM_MB:
        capped = max(limit - HEADROOM_MB, 0)
        print(
            f"BALLAST_MB={wanted} no cabe en el límite del contenedor ({limit} MB): "
            f"se reservan {capped} MB. Sube BALLAST_LIMIT_MB para reservar más.",
            file=sys.stderr,
        )
        wanted = capped

    # Terminar limpio con `docker stop` (PID 1 ignora las señales sin manejador).
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

    # Bloques de 1 MiB con contenido distinto de cero: una página que sólo
    # contiene ceros se puede deduplicar o no llegar a reservarse. `bytearray(b)`
    # copia el bloque, así que las páginas quedan realmente escritas.
    template = bytearray(b"\x5a") * MIB
    ballast = [bytearray(template) for _ in range(wanted)]
    print(f"Lastre activo: {len(ballast)} MB residentes. Durmiendo.", flush=True)

    while True:
        signal.pause()


if __name__ == "__main__":
    main()
