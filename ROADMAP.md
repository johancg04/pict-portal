# 🗺️ Roadmap — Reducir llamadas a los endpoints (anti-sobrecarga)

Problema: mientras alguien dibuja, el cliente manda snapshots a `/api/guess` de forma
repetida. Si sube la frecuencia o hay varias salas activas, se generan **muchísimas
solicitudes** a Gemini → se agota la cuota/coste y "puede explotar".

Objetivo: bajar drásticamente las llamadas sin perder la sensación de "IA adivinando en vivo".

Equipo: **Matías**, **Johan**, **Eduardo**. Tareas pequeñas, por prioridad.

---

## 🔴 P0 — Crítico (hacer primero, en paralelo)

| # | Responsable | Tarea |
| --- | --- | --- |
| 7 | **Eduardo** | **Rate-limit en el servidor** (`/api/guess`): tope por sala/tiempo (~1 cada 2.5s por `roomCode`), responder `429 { skip: true }` sin llamar a Gemini. Última línea de defensa. |
| 8 | **Johan** | **AbortController** en el bucle de guess: abortar la solicitud anterior antes de disparar la siguiente. Evita solapamientos. |
| 9 | **Matías** | **Llamar solo si el canvas cambió**: hash del snapshot vs. el último; si no cambió, no gastar la llamada. |

## 🟠 P1 — Importante (después de P0)

| # | Responsable | Tarea |
| --- | --- | --- |
| 10 | **Matías** | **Saltar snapshots vacíos/casi en blanco**: no enviar el lienzo antes de que haya trazos. |
| 11 | **Johan** | **Intervalo adaptativo**: espaciar cuando no hay actividad, acelerar (con mínimo) al dibujar. *Depende de #8 y #9.* |
| 12 | **Eduardo** | **Debounce de `/api/hint`**: cooldown entre pistas + botón deshabilitado mientras hay una en curso. |

## 🟡 P2 — Cierre

| # | Responsable | Tarea |
| --- | --- | --- |
| 13 | **Johan** | **Verificar build + prueba de carga**: `tsc` + `next build`, contar solicitudes reales a `/api/guess` antes/después, y confirmar que el `429` se maneja sin romper la UI. *Depende de todas las anteriores.* |

---

## Reparto por persona

- **Matías:** #9 (P0) → #10 (P1)
- **Johan:** #8 (P0) → #11 (P1) → #13 (P2)
- **Eduardo:** #7 (P0) → #12 (P1)

> Las tareas también están en el **panel de tareas de Cowork** de la sesión (mismos números).

---

# ✨ Roadmap — Nuevas funcionalidades

Ideas de mejora del juego (sin modo peruano por ahora). Tareas pequeñas, por prioridad,
repartidas entre **Matías**, **Johan** y **Eduardo**.

## 🟢 P1 — Alto impacto / demo-friendly

| # | Responsable | Funcionalidad |
| --- | --- | --- |
| 14 | **Johan** | **Barra de dibujo**: colores, grosor y borrador (el color/grosor viaja por el canal `draw`). |
| 15 | **Matías** | **Enlace de invitación** con `?room=` + botón copiar; entrar directo al abrirlo. |
| 16 | **Eduardo** | **Efectos de sonido** (acierto, ronda, victoria) + botón silenciar persistido. |

## 🔵 P2 — Profundidad de juego

| # | Responsable | Funcionalidad |
| --- | --- | --- |
| 17 | **Johan** | **Puntaje por velocidad + rachas** (más puntos al más rápido, bonus por racha). |
| 18 | **Eduardo** | **Dificultad de la IA** (fácil/normal/difícil) difundida por `game-config`. |
| 19 | **Matías** | **Sistema de categorías/packs** de palabras (General, Animales, Comida…). Base reusable. |

## ⚪ P3 — Nice-to-have

| # | Responsable | Funcionalidad |
| --- | --- | --- |
| 20 | **Johan** | **Galería/replay** de los dibujos al final, junto al podio. |
| 21 | **Eduardo** | **Controles de anfitrión**: expulsar jugador / palabras personalizadas. |

## Reparto por persona (funcionalidades)

- **Matías:** #15 (P1) → #19 (P2)
- **Johan:** #14 (P1) → #17 (P2) → #20 (P3)
- **Eduardo:** #16 (P1) → #18 (P2) → #21 (P3)
