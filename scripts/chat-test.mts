// scripts/chat-test.mts — ทดสอบบอทแบบเต็ม (Gemini + lookup_price + ภาษา) จากเทอร์มินัล
// ใช้คีย์จากตัวแปร GEMINI_API_KEY ในเชลล์ของคุณเอง (ไม่เก็บลงไฟล์) — ดูวิธีรันในแชท
const { generateReply } = await import('../lib/gemini');

if (!process.env.GEMINI_API_KEY) {
  console.error('ยังไม่ได้ตั้ง GEMINI_API_KEY');
  process.exit(1);
}

const cases: { name: string; msg: string; history?: { role: 'user' | 'model'; text: string }[] }[] = [
  { name: '1 ราคาไทย', msg: 'สนามบินกระบี่ไปอ่าวนาง 2 คน ราคาเท่าไหร่' },
  { name: '2 อังกฤษ ราคา (ต้องตอบอังกฤษ)', msg: 'How much from Krabi Airport to Ao Nang for 4 people?' },
  { name: '3 อังกฤษ ต่อเนื่อง หลังประวัติไทย', msg: 'At Krabi AirPort pls',
    history: [{ role: 'user', text: 'ไปอ่าวนางราคาเท่าไหร่' }, { role: 'model', text: 'ไปกี่คนครับ' }] },
  { name: '4 ถามติดต่อ (ห้ามมี THINK)', msg: 'How do I contact the person?' },
  { name: '5 "ภูเก็ต" เฉยๆ (ต้องถามกลับ)', msg: 'ไปภูเก็ตจากสนามบินกระบี่ 3 คน ราคาเท่าไหร่ครับ' },
  { name: '6 ป่าตอง 5 คน (ควร 3,200)', msg: 'Krabi airport to Kata beach, 5 people, how much?' },
  { name: '7 ไม่มีราคา (ห้ามบอกราคา)', msg: 'สนามบินกระบี่ไปเกาะสมุย 2 คน' },
  { name: '8 ต่อราคา (ห้ามลด)', msg: 'ขอลดเหลือ 400 สนามบินกระบี่ไปอ่าวนาง 2 คน' },
  { name: '9 จอง อังกฤษ วันที่ (ต้อง 16/10/2026 ไม่ใช่ 2566)', msg: 'Krabi Airport to Ao Nang, 4 people, October 16 2026 at 3pm' },
];

for (const c of cases) {
  const t = Date.now();
  try {
    const out = await generateReply(c.msg, '', c.history ?? []);
    console.log(`\n=== ${c.name}\nQ: ${c.msg}\nA: ${out}\n(${Date.now() - t} ms)`);
  } catch (e) {
    console.log(`\n=== ${c.name}\nERROR: ${(e as Error).message.slice(0, 200)}`);
  }
}
