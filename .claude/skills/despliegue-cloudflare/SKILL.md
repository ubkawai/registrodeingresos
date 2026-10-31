---
name: despliegue-cloudflare
description: Publicar o actualizar la app en Cloudflare Pages, configurar variables de build y Supabase, y resolver builds fallidos. Usar cuando el usuario pida subir, publicar, desplegar o arreglar la app en la nube.
---

# Despliegue en Cloudflare Pages

La app se publica gratis en Cloudflare Pages, conectada al repo de GitHub `ubkawai/registrodeingresos` (rama `main`). Cada `git push` a `main` publica una versión nueva automáticamente.

## Publicar cambios

1. Revisar `git status`: que no se suba `.env` ni secretos (ver skill `seguridad-secretos`).
2. Hacer commit con un mensaje en español que describa el cambio, y luego `git push`.
3. Avisar al usuario que Cloudflare tarda entre 1 y 3 minutos (pestaña **Deployments** del proyecto).

## Configuración del proyecto en Cloudflare

| Campo | Valor |
|---|---|
| Framework preset | React (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | vacío |

Variables de build (Settings → Variables and Secrets / Environment variables). Deben existir en el momento del build porque Vite las incrusta en el código al compilar:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_FACTILIZA_TOKEN`
- `NODE_VERSION` = `20`

Si se agrega una variable `VITE_*` nueva, también hay que agregarla en Cloudflare y en `.env.example`, y volver a publicar.

## Supabase

En Authentication → URL Configuration, la URL pública (`https://<proyecto>.pages.dev` o el dominio propio) debe figurar en **Site URL** y en **Redirect URLs** (`https://<url>/**`). Las migraciones nuevas también se aplican en la nube (`supabase db push` o SQL Editor).

## Problemas conocidos

- **Deploy command `npx wrangler deploy`**: el proyecto se creó como Worker y no como Pages. Para Workers existe `wrangler.jsonc` (assets en `./dist`, `not_found_handling: single-page-application`). En Pages el aviso sobre `wrangler.jsonc` se puede ignorar.
- **El build compila código viejo**: faltó hacer commit o push.
- **Pantalla en blanco o error de Supabase en producción**: faltan las variables de build. Agregarlas y hacer Retry deployment.
- **El login no redirige bien**: falta la URL en Supabase URL Configuration.
- **La cámara no abre**: requiere HTTPS. Pages ya lo da, así que hay que revisar los permisos del navegador.
- **Proyecto Supabase pausado**: en el plan gratuito se pausa tras 7 días sin uso. Se reactiva desde el panel de Supabase.
