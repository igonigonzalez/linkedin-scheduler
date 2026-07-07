# LinkedIn Scheduler

A free, self-hosted LinkedIn post scheduler. Write your post, add a first comment 
(great for hiding links), attach media, pick a date — and it publishes automatically.

Built as a lightweight alternative to Buffer or Metricool, using your own 
LinkedIn OAuth credentials.

## Features

- **Schedule posts** to your personal LinkedIn profile
- **First comment** auto-posted right after publishing (perfect for links)
- **Media support** — images, video, multi-image carousel
- **Auto-publish** via external cron (no server needed, works on Vercel free tier)
- **Multi-user** — anyone can connect their own LinkedIn account via OAuth
- **Token auto-refresh** — stays alive for months without manual re-auth

## Stack

Next.js 15 · Supabase · Vercel · LinkedIn REST API

## Quick start

1. Clone the repo
2. Create a LinkedIn Developer App (attach it to any Company Page)
3. Set up a Supabase project and run `supabase/schema.sql`
4. Fill in `.env.local` (see `.env.example`)
5. Deploy to Vercel + set a cron on [cron-job.org](https://cron-job.org) every 5 min

---

> **En español:** Programador de posts para LinkedIn gratuito y open-source. 
> Escribe, adjunta media, pon el primer comentario con el enlace y se publica solo. 
> Alternativa a Metricool/Buffer sin pagar mensualidad.
