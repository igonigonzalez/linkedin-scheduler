# LinkedIn Scheduler

Mini Metricool/Buffer propio: programa posts en tu **perfil personal de LinkedIn**, con
**primer comentario automático** y **media** (imagen, vídeo, GIF). Next.js + Supabase, desplegable en Vercel.

## Cómo funciona

1. Conectas tu LinkedIn por OAuth (una vez).
2. Escribes el post, el primer comentario y subes media. Eliges fecha/hora.
3. Se guarda en Supabase. La media va a Supabase Storage.
4. Un **cron externo** llama cada pocos minutos a `/api/cron/publish`. Ese endpoint busca los posts
   cuya hora ya pasó, los publica vía API oficial de LinkedIn, sube la media y deja el primer comentario.

---

## 1) Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (free tier vale).
2. **SQL Editor → New query** → pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo.
   Crea las tablas, el índice y el bucket público `media`.
3. **Project Settings → API**, copia:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (¡secreta, solo servidor!)

## 2) LinkedIn Developer App

1. Ve a [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**.
   - LinkedIn obliga a asociarla a una **Company Page** (usa la de YAMATO).
2. Pestaña **Products** → añade:
   - **Sign In with LinkedIn using OpenID Connect** (da `openid`, `profile`).
   - **Share on LinkedIn** (da `w_member_social` → publicar y comentar).
3. Pestaña **Auth**:
   - Copia `Client ID` y `Client Secret`.
   - En **Authorized redirect URLs** añade EXACTAMENTE:
     - `http://localhost:3000/api/auth/linkedin/callback` (local)
     - `https://TU-APP.vercel.app/api/auth/linkedin/callback` (producción)
4. Verifica la app con tu Company Page si LinkedIn lo pide (botón "Verify").

> Permisos disponibles tras aprobación: `w_member_social` (Share on LinkedIn) suele ser de acceso
> directo. Si algún scope aparece restringido, solicítalo en la pestaña Products.

## 3) Variables de entorno

Copia `.env.example` a `.env.local` y rellena todo:

```bash
cp .env.example .env.local
```

Genera un `CRON_SECRET` largo y aleatorio (p.ej. `openssl rand -hex 32`).
`APP_PASSWORD` es opcional: si lo pones, la web pide usuario `admin` + esa contraseña (Basic Auth).

## 4) Local

```bash
npm install
npm run dev
```

Abre http://localhost:3000 → **Conectar LinkedIn** → autoriza.
Crea un post de prueba con "Publicar ahora".
Para dispararlo sin esperar al cron, abre en el navegador:

```
http://localhost:3000/api/cron/publish?secret=TU_CRON_SECRET
```

## 5) Deploy en Vercel

```bash
npm i -g vercel   # si no lo tienes
vercel            # primer deploy
vercel --prod
```

- En el dashboard de Vercel → **Settings → Environment Variables**: mete TODAS las del `.env.local`,
  pero cambia `LINKEDIN_REDIRECT_URI` a tu URL de producción
  (`https://TU-APP.vercel.app/api/auth/linkedin/callback`) y añádela también en LinkedIn (paso 2.3).
- Redeploy tras meter las variables.

## 6) El cron (clave: algo encendido 24/7)

Tu PC apagado NO publica. Necesitas un pinger externo. **Configurado: GitHub Actions**
(`.github/workflows/cron-publish.yml`), que llama al endpoint cada 5 minutos.

Setup (una sola vez): en GitHub → repo → **Settings → Secrets and variables → Actions** →
New repository secret → nombre `CRON_SECRET`, valor el mismo que en Vercel.

> La resolución de programación = frecuencia del cron. Cada 5 min = los posts salen con ≤5 min de
> desfase respecto a la hora fijada (los schedules de GitHub pueden añadir unos minutos extra en
> horas punta). OJO: GitHub desactiva los schedules tras 60 días sin commits; avisa por email.

Alternativas: cron-job.org (gratis, mismo GET con `?secret=`), o Vercel Cron (en Hobby es 1×/día
y sin minuto garantizado — está en `vercel.json` solo como respaldo; en Pro permite por minuto).

---

## Notas y límites (honestos)

- **Token**: caduca a los ~60 días. La app lo renueva sola con el refresh token cuando quedan <2 días,
  siempre que el cron corra. Si caduca del todo, pulsa **Reconectar**.
- **Primer comentario**: vía `/rest/socialActions/{urn}/comments`. Es la parte más propensa a necesitar
  un ajuste fino en el primer test real (marcado `// LIVE-TEST` en `src/lib/linkedin.ts`).
- **GIF animado**: LinkedIn no lo soporta limpio por API; un `.gif` se sube como imagen (probablemente
  estática). Para animación real, convierte a MP4 y súbelo como vídeo.
- **Vídeo**: clips cortos van bien. Vídeos grandes/largos chocan con el timeout de la función serverless
  (60s) y con el procesado asíncrono de LinkedIn; pueden requerir reintento.
- **Multi-media**: varias imágenes → carrusel (multiImage). Vídeo siempre solo.
- **`commentary`**: LinkedIn obliga a escapar caracteres reservados (`( ) [ ] { } @ # * _ ~ | < >`).
  Se hace automático en `escapeCommentary()`.
- **Solo perfil personal** en esta versión. Para publicar también en la Company Page hace falta el
  producto **Community Management API** (requiere revisión de LinkedIn) y usar `author = urn:li:organization:ID`.

## Estructura

```
src/
  lib/linkedin.ts        Cliente API LinkedIn (OAuth, media, post, comentario)
  lib/supabase.ts        Cliente servidor (service role)
  lib/supabaseClient.ts  Cliente navegador (anon, solo subir media)
  app/page.tsx           Carga cuenta + posts (server)
  app/dashboard.tsx      UI (composer + cola)
  app/api/auth/linkedin  OAuth start + callback
  app/api/upload         URL firmada para subir media
  app/api/posts          Listar / crear / borrar / editar
  app/api/cron/publish   Publicador (lo llama el cron)
supabase/schema.sql      Tablas + bucket
middleware.ts            Basic Auth opcional (APP_PASSWORD)
```
