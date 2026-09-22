# Apps Script + Phase 0 setup checklist (ต้องทำโดยแชมป์ — มีบัญชี/ต้องคลิกยืนยันเอง)

โค้ดในโฟลเดอร์นี้เป็น "โค้ดอ้างอิง" ที่ต้าวอ้นเตรียมไว้ ไม่ใช่โค้ดที่ deploy อยู่จริง — Apps Script ตัวจริงอยู่ใน script.google.com ในบัญชี Google ของแชมป์ ไม่ได้ผูกกับ repo นี้ ต้องเปิดเองแล้วต่อโค้ดเข้าไป (ดูคอมเมนต์บนสุดของ `dispatch-extensions.gs`)

## สิ่งที่ต้องทำก่อนระบบนี้ใช้งานได้จริง (Phase 0)

1. **สร้าง Google Sheet ใหม่** ชื่อ `CTT - Driver Roster & Dispatch` มี 4 แท็บ (ใส่หัวตารางแถวแรกตามนี้เป๊ะๆ เพราะโค้ดอ่านตามชื่อคอลัมน์):
   - `Drivers`: driver_id, display_name, line_user_id, phone, license_class, license_expiry, active, role, joined_date, notes
   - `Availability_Monthly`: driver_id, month, available_dates, submitted_at, status
   - `Assignments_Log`: booking_event_id, calendar_id, driver_id, status, job_date, job_start_time, proposed_at, confirmed_at, notified_at
   - `Leave_Requests`: request_id, driver_id, dates, reason, requested_at, status, affected_booking_event_id, resolved_at
   - ใส่แถวแรกของ `Drivers` เป็นแชมป์เอง (role=owner) + บอล + โตน — ใส่ `line_user_id` ให้ครบ (วิธีหา: ให้แต่ละคนทักแชท @ctt.trip365 มา 1 ครั้ง แล้วดู userId จาก log ใน Vercel, หรือดูจาก LINE Official Account Manager)

2. **สร้าง Telegram bot** — เปิดแชท [@BotFather](https://t.me/BotFather) ใน Telegram ของแชมป์ พิมพ์ `/newbot` ทำตามขั้นตอน จะได้ **bot token** มา (เก็บไว้ ห้ามแชร์ใครนอกจากใส่ใน Vercel env var)
   - หา **chat_id ของแชมป์เอง**: ทักแชทหาบอทที่สร้างไว้ 1 ข้อความ แล้วเปิด `https://api.telegram.org/bot<TOKEN>/getUpdates` ในเบราว์เซอร์ จะเห็น `chat.id` ในผลลัพธ์

3. **เปิด Apps Script editor** ของสคริปต์ที่ผูกกับ `CALENDAR_WEBHOOK_URL` ปัจจุบัน → ต่อโค้ดจาก `dispatch-extensions.gs` เข้าไป (ดูคอมเมนต์ในไฟล์นั้นสำหรับขั้นตอนละเอียด) → ตั้งค่า Script Properties เพิ่ม `CALENDAR_ID` และ `DRIVER_SHEET_ID` → Deploy ทับ deployment เดิม (ไม่สร้างใหม่ กัน URL เปลี่ยน)

4. **ตั้งค่า env vars ใหม่ใน Vercel** (Project Settings → Environment Variables):
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAMP_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` (ตั้งเองเป็นสตริงสุ่ม), `DISPATCH_API_SECRET` (ตั้งเองเป็นสตริงสุ่ม), `CRON_SECRET` (ตั้งเองเป็นสตริงสุ่ม — Vercel จะส่งมาใน header ให้เองตอนเรียก cron)

5. **ลงทะเบียน Telegram webhook** หลัง deploy ขึ้น Vercel แล้ว (มี URL จริงของ `/api/telegram-webhook`):
   ```
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-vercel-domain>/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```

6. **ตั้งริชเมนูแยกให้คนขับ** (ทางเลือก เฟส 1 ยังไม่จำเป็น — ตอนนี้คนขับพิมพ์ "วันว่าง"/"ขอลา" เป็นข้อความธรรมดาก็ใช้งานได้แล้ว) ทีหลังค่อยใช้ `linkRichMenuToUser` ผูกเมนูปุ่มให้คนขับแต่ละคนแยกจากลูกค้า

ทำครบข้อ 1-5 แล้วบอกต้าวอ้นได้เลย จะช่วยทดสอบ end-to-end ต่อ (ดู "Verification" ในแผนงาน `~/.claude/plans/sequential-mixing-waterfall.md`)
