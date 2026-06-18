# CLAUDE.md — LINE Bot AI · CTT Project

## What we're building

LINE Official Account bot สำหรับ Champion Tour and Transport (CTT) กระบี่
ตอบลูกค้า 24 ชม. โดยใช้ Gemini อ่าน FAQ จาก Google Sheet ส่ง reply กลับ LINE

## Stack — locked

- Next.js 14 App Router + TypeScript
- `@line/bot-sdk` for LINE Messaging API
- `@google/genai` for Gemini
- Google Sheet CSV public URL for FAQ
- Vercel for hosting (Hobby tier)
- pnpm

## Repo layout

- `app/api/line-webhook/route.ts` — POST handler (verify signature → process → reply)
- `lib/sheet.ts` — fetch + parse + cache CSV (60s TTL)
- `lib/gemini.ts` — call Gemini with system prompt
- `lib/prompts.ts` — buildSystemPrompt (Hallucination Guard 2-layer)
- `lib/handoff.ts` — Smart Handoff trigger detection + notify admin
- `lib/flex-cards.ts` — Flex Message builders
- `lib/log.ts` — structured JSON logging

## Env vars (Vercel)

- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `GEMINI_API_KEY`
- `SHEET_CSV_URL` — Google Sheet CSV export URL
- `ADMIN_GROUP_ID` — LINE Group ID สำหรับ Smart Handoff notify

## Business context

- ธุรกิจ: รถตู้รับส่งสนามบิน ทัวร์เกาะ เช่ารถตู้รายวัน จ.กระบี่
- เส้นทางหลัก: สนามบินกระบี่ → อ่าวนาง / เกาะลันตา / พีพี / ภูเก็ต / เขาหลัก
- ลูกค้า: นักท่องเที่ยวไทยและต่างชาติ + โรงแรม + Agent
- Bot persona: "พี่แชมป์ AI" — เป็นกันเอง อบอุ่น มืออาชีพ

## Don'ts

- ❌ Hardcode token/key — ใช้ env vars เท่านั้น
- ❌ Skip signature verification — security risk
- ❌ Skip Gemini timeout — webhook ต้องตอบภายใน 10s
- ❌ Cache FAQ เกิน 60s — เจ้าของแก้ Sheet ควรเห็นผลเร็ว
- ❌ Log message content เต็ม — PII risk · log แค่ metadata
