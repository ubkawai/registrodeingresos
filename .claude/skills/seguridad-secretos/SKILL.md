---
name: seguridad-secretos
description: Reglas para manejar claves, tokens y archivos .env en este proyecto. Usar antes de cada commit o push, al agregar variables de entorno o al integrar un API con token.
---

# Seguridad de secretos

## Reglas

1. **Nunca versionar `.env`** ni ningún `.env.*`. Ya están en `.gitignore`, salvo `.env.example`.
2. `.env.example` lista los nombres de las variables **sin valores**. Mantenerlo al día cuando se agregue una variable.
3. Antes de cada commit, revisar con `git status` y `git diff --cached` que no se suban tokens, contraseñas ni claves `service_role`.
4. Los valores reales en producción se configuran en Cloudflare (variables de build), no en el repo.

## Variables `VITE_*` son públicas

Todo lo que empieza con `VITE_` queda incrustado en el JavaScript publicado y cualquiera puede verlo.

- `VITE_SUPABASE_PUBLISHABLE_KEY`: es pública por diseño. Los datos los protegen las políticas RLS de Supabase, que deben mantenerse activas en todas las tablas.
- `VITE_FACTILIZA_TOKEN`: **es un secreto** y hoy está expuesto en el frontend (`src/lib/dni.ts`). Lo correcto es mover la consulta a una Edge Function de Supabase (como `admin-users`), guardar el token con `supabase secrets set` y llamarla desde el frontend. Proponerlo si se trabaja en esa parte.
- La clave `service_role` de Supabase **nunca** va al frontend. Solo se usa en Edge Functions.

## Si un secreto se filtró

Si un secreto llegó a un commit (aunque luego se borre), sigue en el historial de git.

1. **Rotarlo**: generar uno nuevo en el proveedor y anular el anterior.
2. Actualizar el valor en el `.env` local y en Cloudflare, y volver a publicar.
3. No hace falta reescribir el historial de git si el secreto ya se rotó.

Historial: hasta el commit `eab11c5`, `.env` se versionaba (con el token de Factiliza). Desde `468b8a0` ya no.
