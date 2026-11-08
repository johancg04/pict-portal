<h1 align="center">🎨 Pict-Portal</h1>

<p align="center">
  <em>Pictionary multijugador en tiempo real donde una IA dibuja, adivina y compite contigo.</em><br/>
  <em>Realtime multiplayer Pictionary where an AI draws, guesses and competes with you.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Equipo-Trazando%20con%20IA-6366F1?style=for-the-badge" alt="Equipo" />
  <img src="https://img.shields.io/badge/Realtime-Portal-22D3C5?style=for-the-badge" alt="Portal" />
  <img src="https://img.shields.io/badge/Hackathon-The%20Realtime%20Hackathon-7C3AED?style=for-the-badge" alt="Hackathon" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-000000?style=flat&logo=nextdotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat&logo=tailwindcss&logoColor=white" />
  <img src="https://img.shields.io/badge/Portal-22D3C5?style=flat&logoColor=white" />
  <img src="https://img.shields.io/badge/Gemini-8E75B2?style=flat&logo=googlegemini&logoColor=white" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=flat&logo=vercel&logoColor=white" />
</p>

---

## 👥 Equipo / Team — *Trazando con IA*

| Integrante | Rol |
| --- | --- |
| **Matías Carrillo** | Desarrollo |
| **Johan Contreras** | Desarrollo |
| **Eduardo Velasquez** | Desarrollo |

Proyecto para **The Realtime Hackathon by Portal**.

---

## 🕹️ Sobre el proyecto / About the project

### 🇪🇸 Español

- 🎨 **Pict-Portal** es un Pictionary multijugador en tiempo real: alguien dibuja y el resto adivina, todo en vivo.
- 🤖 Una **IA es un jugador más**: mira los trazos y adivina, y en su turno **dibuja ella misma** trazo por trazo.
- 🏠 **Salas con código** para invitar a tus amigos, presencia en vivo, chat de respuestas, cursores, reacciones y pistas con IA.
- 🏆 Elige **cuántas rondas** dura la partida y al final se muestra un **podio** con el ganador.
- 🌗 Modo **claro / oscuro** y sin registro: comparte el código y a dibujar.

### 🇬🇧 English

- 🎨 **Pict-Portal** is a realtime multiplayer Pictionary: one person draws, everyone else guesses, all live.
- 🤖 An **AI plays as another player**: it watches the strokes and guesses, and on its turn it **draws by itself** stroke by stroke.
- 🏠 **Rooms with a code** to invite friends, live presence, guess chat, cursors, reactions and AI hints.
- 🏆 Pick **how many rounds** the game lasts and see a **winner podium** at the end.
- 🌗 **Light / dark** mode and no sign-up: share the code and start drawing.

---

## ⚡ Cómo usamos Portal / How we use Portal

Portal es la **columna vertebral en tiempo real** de todo el juego. Cada sala vive sobre
varios canales de Portal, en **modo anónimo** (solo con la clave publicable `pk_`), sin
tener que montar servidores de websockets ni auth propia.

Portal is the **realtime backbone** of the whole game. Each room runs on several Portal
channels in **anonymous mode** (just the publishable `pk_` key), with no custom websocket
servers or auth.

| Canal / Channel | Uso / Usage |
| --- | --- |
| `game:<code>` | Control de la partida: inicio/fin de ronda, turnos, config de rondas, reinicio, nombres. |
| `chat:<code>` | Respuestas de jugadores y de la IA + mensajes de sistema (persistente, con historial). |
| `draw:<code>` | Trazos del dibujante en vivo como mensajes **ephemeral** (alta frecuencia, sin persistir). |
| `cursor:<code>` | Posición del lápiz en vivo (ephemeral, `history: "none"`). |
| `reactions:<code>` | Emojis que cualquiera lanza y flotan para todos (fan-out puro). |

Además aprovechamos de Portal:

- 🟢 **Presencia por actividad** (`sendActivity` / `activity`): un latido "online" que arma
  el roster en vivo y detecta cuándo alguien se va en segundos.
- ✍️ **Indicador de "escribiendo"** (`typing`) en el chat.
- 📨 **Ephemeral vs persistente**: trazos y cursores efímeros; rondas y chat persistentes,
  así los que entran tarde reciben el estado por **history**.
- 🔌 **Modo anónimo + orígenes permitidos** para desplegar sin backend de auth.

> Lo único que **no** es Portal es la visión de la IA (recorre a un modelo desde el
> servidor). Todo lo demás —sincronizar personas, la IA y los eventos en vivo— es Portal.

---

## 🛠️ Tecnologías / Tech Stack

**Frontend:** Next.js (App Router) · React · TypeScript · Tailwind CSS
**Tiempo real / Realtime:** Supabase (Realtime Broadcast + Presence, tabla `room_messages`)
**IA / AI:** Google Gemini (adivinar, dibujar y pistas)
**Deploy:** Vercel

---

## 🚀 Correr en local / Run locally

```bash
# 1. Instalar dependencias / install deps
npm install

# 2. Variables de entorno / env vars
cp .env.local.example .env.local
#   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co   (Supabase > Project Settings > API)
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...                (clave anon pública)
#   GEMINI_API_KEY=...               (clave de Google Gemini, opcional)
#   GEMINI_MODEL=gemini-flash-lite-latest
#   SUPABASE_SERVICE_ROLE_KEY=...    (opcional, solo servidor: guarda y reutiliza
#                                     los dibujos de la IA en la tabla ai_drawings)

# 3. Base de datos (una sola vez) / database (once)
#   En el dashboard de Supabase: SQL Editor -> pega supabase/schema.sql -> Run

# 4. Desarrollo / dev
npm run dev
```

Abre **http://localhost:3000** en dos ventanas (o una normal + una incógnito) para
verlo en vivo. La IA funciona con la clave de Gemini; sin ella, el juego en tiempo
real sigue andando y la IA simplemente no participa.

---

## ✨ Características / Features

- 🎨 Lienzo compartido en tiempo real (trazos, colores, borrar)
- 🤖 IA que adivina y dibuja su propio turno
- 🏠 Salas con código · 👥 presencia en vivo · 💬 chat de respuestas
- 🖱️ Cursores en vivo · 🎉 reacciones con emojis · 💡 pistas con IA
- 🔁 Rotación de turnos · ⏱️ temporizador de ronda · 🏆 podio final
- 🌗 Tema claro/oscuro · 🔊 sonido de victoria

---

<p align="center"><sub>Hecho con 🎨 y ⚡ por <b>Trazando con IA</b> · Powered by Portal</sub></p>
