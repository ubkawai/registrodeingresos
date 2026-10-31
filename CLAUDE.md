# Registro de Ingresos con Lector de Barras

App web para controlar el ingreso de acampantes/invitados (lector de DNI) y la asistencia del personal. Responder al usuario en español.

## Stack

- React + Vite + TypeScript, Tailwind + shadcn/ui (`src/components/ui`), React Router (`BrowserRouter`, una sola ruta `/`).
- Supabase: auth, base de datos (migraciones en `supabase/migrations`) y Edge Function `admin-users`.
- Publicación: Cloudflare Pages desde GitHub `ubkawai/registrodeingresos`, rama `main` (ver skill `despliegue-cloudflare`).
- Pruebas e2e con Playwright (`e2e/`, `npm run test:e2e`).

## Estructura

- `src/pages/Index.tsx`: controla la sesión (`getSession` / `onAuthStateChange`), lee el rol en `profiles` y elige el módulo. Sin sesión muestra `<Auth />`.
- `src/components/Auth.tsx`: pantalla de login (`signInWithPassword`).
- Roles: `usuario` → Eventos; `rrhh` → Asistencia; `kiosko` → solo marcado de Asistencia; `admin` → elige el módulo (se recuerda en localStorage).
- `src/pages/Eventos.tsx`: ingreso de invitados y acampantes (listas `scan_lists` / `scanned_records`, padrón).
- `src/pages/Asistencia.tsx` + `src/components/asistencia/`: marcador, hoy en vivo, reportes, trabajadores, configuración.
- `src/lib/dni.ts`: busca DNI primero en la tabla `acampantes` y luego en el API Factiliza, y guarda el resultado.
- `src/lib/asistencia.ts`: cálculo de jornadas (tardanza, horas, sobretiempo). Las marcas solo se crean con las funciones SQL `marcar_asistencia` y `registrar_marca_manual`.

## Reglas

- El lector usa la cámara, que solo funciona con HTTPS o en localhost.
- Secretos: seguir la skill `seguridad-secretos` (nunca versionar `.env`).
- Cada cambio de esquema va como una nueva migración en `supabase/migrations` y además hay que aplicarlo en el proyecto Supabase en la nube.
