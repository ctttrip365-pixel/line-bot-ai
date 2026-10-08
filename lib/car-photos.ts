// lib/car-photos.ts — ส่ง "รูปรถ" เป็นรูปจริงในแชท LINE (ไม่ใช่ลิงก์) เมื่อลูกค้าขอดูรูปรถ
//
// วิธีใช้ (แชมป์สั่ง 8 ต.ค. 2026: แนบเป็นไฟล์รูป ไม่ใช่ลิงก์):
//   1) ย่อรูปเป็น JPEG ด้านยาวไม่เกิน ~1024px และไฟล์ไม่เกิน 1 MB (LINE ใช้ไฟล์เดียวเป็นทั้งรูปจริงและรูปตัวอย่าง)
//   2) วางไฟล์ในโฟลเดอร์ public/cars/ ของโปรเจกต์ แล้วใส่ชื่อไฟล์ในอาร์เรย์ CAR_PHOTO_FILES ด้านล่าง (สูงสุด 4 รูป — ข้อความตอบกลับ 1 ครั้งส่งได้ 5 ข้อความ รวมข้อความนำ)
//   3) deploy — ลูกค้าพิมพ์ "ขอรูปรถ" จะได้รูปจริงเลย (LINE ดึงรูปจาก URL https ของเว็บเรา แล้วแสดงเป็นรูปในแชท ลูกค้าไม่เห็นลิงก์)
// อาร์เรย์ว่าง = ปิดฟีเจอร์ บอทจะตอบจาก FAQ ว่าพี่แชมป์จะส่งรูปให้ + ส่งต่อ (พฤติกรรมเดิม)
// ข้อควรระวัง: repo เป็น PUBLIC รูปที่อยู่ใน public/ ทุกคนเปิดดูได้ — เลือกเฉพาะรูปที่ยอมให้เห็นสาธารณะ (ป้ายทะเบียนติดในรูปได้ ถ้าแชมป์โอเค)

// แชมป์เลือก 4 รูป 8 ต.ค. 2026: van-1/2 ภายนอก, van-3 ภายในเบาะหนัง (คัน 30-2984), van-4 ภายใน VIP (คัน 36-0189) — ต้นฉบับอยู่ที่ Marketing/รูปรถตู้-สำหรับบอท/
export const CAR_PHOTO_FILES: string[] = ['van-1.jpg', 'van-2.jpg', 'van-3.jpg', 'van-4.jpg'];

const MAX_PHOTOS = 4;

/** ลูกค้าขอดูรูปรถไหม (ไทย/อังกฤษ) */
export function wantsCarPhotos(text: string): boolean {
  return /รูปรถ|(ขอ|ดู|อยากดู|ส่ง).{0,6}รูป.{0,8}(รถ|ตู้|SUV)|(photos?|pictures?|pics?|images?) of (your |the )?(vans?|cars?|vehicles?|suv)|show me (your |the )?(vans?|cars?|vehicles?)/i.test(text);
}

/** URL เว็บที่เปิดให้ LINE ดึงรูป: PUBLIC_BASE_URL (ตั้งเองได้) หรือโดเมน production ของ Vercel */
function baseUrl(): string | null {
  const explicit = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '').trim();
  return vercel ? `https://${vercel}` : null;
}

export interface CarPhotoMessage {
  type: 'image';
  originalContentUrl: string;
  previewImageUrl: string;
}

/** ข้อความรูปสำหรับ replyMessage (ว่าง = ยังไม่ได้ตั้งรูป หรือหา URL ไม่ได้) */
export function carPhotoMessages(): CarPhotoMessage[] {
  const base = baseUrl();
  if (!base || CAR_PHOTO_FILES.length === 0) return [];
  return CAR_PHOTO_FILES.slice(0, MAX_PHOTOS).map((f) => {
    const url = `${base}/cars/${encodeURIComponent(f)}`;
    return { type: 'image', originalContentUrl: url, previewImageUrl: url };
  });
}
