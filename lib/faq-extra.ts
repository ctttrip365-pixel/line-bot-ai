// lib/faq-extra.ts — คำถาม-คำตอบที่แชมป์อนุมัติแล้ว เพิ่มเข้า FAQ ของบอทโดยตรงจากโค้ด (รวมกับแถวในชีต FAQ ตอนสร้างดัชนี)
//
// ที่มา: แชมป์ให้เพื่อนลองถามบอทหลายสิบข้อ (8 ต.ค. 2026) ข้อที่บอทตอบไม่ได้ถูกสกัดมาเติมที่นี่ทีละชุด
// กติกา: ใส่เฉพาะข้อมูลที่ยืนยันแล้วเท่านั้น (จาก CLAUDE.md ของ CTT หรือแชมป์ตอบเอง) ห้ามเดาตัวเลข/นโยบาย
// repo นี้เป็น PUBLIC — ห้ามใส่เลขบัญชี/ข้อมูลส่วนตัว (ข้อมูลช่องทางติดต่อธุรกิจที่ลูกค้าเห็นอยู่แล้วใส่ได้)
// เมื่อแถวไหนย้ายไปอยู่ในชีต FAQ แล้ว ให้ลบออกจากไฟล์นี้ (กันข้อมูลซ้ำสองที่)

export interface ExtraFaqRow {
  category: string;
  question: string;
  answer: string;
}

export const EXTRA_FAQ: ExtraFaqRow[] = [
  // ---- ทัวร์ 4 เกาะ: ราคามีในชีตแล้ว (แถว 15) แต่ฝังในคำตอบ "ที่ไหนบ้าง" ซึ่งอันดับต่ำเมื่อถามเรื่องราคา — แยกเป็นแถวราคาตรงๆ (ข้อมูลเดิม ไม่เพิ่มใหม่) ----
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์ 4 เกาะกระบี่ราคาเท่าไหร่ ทัวร์ 4 เกาะกี่บาท',
    answer: 'ทัวร์ 4 เกาะ ราคา 800 บาท/คน (สปีดโบ๊ท) ไปเยือนเกาะโบ๊ท เกาะไก่ ทะเลแหวก (Unseen Thailand) Emerald Cave และหาดสวยใสครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'How much is the 4-Island tour in Krabi?',
    answer: 'The 4-Island tour (speedboat) is 800 THB per person, visiting Koh Poda, Chicken Island, the Tup Island sandbar (Unseen Thailand), Emerald Cave and a beautiful beach.',
  },
  // ---- ชุดที่ 2 (แชมป์ตอบ 8 ต.ค. 2026): ค่าบริการเสริม / หน้างาน / ล่าม ---- (ตัวเลขเหล่านี้เป็นราคาขายลูกค้า ไม่บวก 15%)
  {
    category: 'ค่าบริการเสริม',
    question: 'ขอแวะระหว่างทาง แวะทานข้าว แวะซื้อของ แวะร้านยา มีค่าใช้จ่ายไหม',
    answer: 'แวะระหว่างทางได้ครับ แวะไม่เกิน 15 นาทีฟรี ถ้าเกิน 15 นาที ค่าแวะระหว่างทาง 100 บาท และบวกเพิ่มชั่วโมงละ 100 บาทครับ',
  },
  {
    category: 'Extra services',
    question: 'Can we make a stop on the way for lunch shopping or a pharmacy? Is there an extra charge?',
    answer: 'Yes, stops on the way are possible. A stop of up to 15 minutes is free. Beyond 15 minutes the stop-over fee is 100 THB, plus an additional 100 THB per hour.',
  },
  {
    category: 'ค่าบริการเสริม',
    question: 'เครื่องบินดีเลย์ ลงช้า ต้องรอนานไหม ค่ารอคิดยังไง รอชั่วโมงละเท่าไหร่ เกินเวลาคิดเพิ่มไหม',
    answer:
      'รอฟรีไม่เกิน 30 นาทีนับจากเวลาเครื่องลงครับ หลังจากนั้นคิดค่ารอชั่วโมงละ 100 บาท รบกวนแจ้งหมายเลขเที่ยวบินตอนจองเพื่อให้กำหนดเวลารับได้ถูกต้องครับ',
  },
  {
    category: 'Extra services',
    question: 'My flight is delayed. How long will the driver wait and is there a waiting fee?',
    answer:
      'Waiting is free for up to 30 minutes after the landing time. After that, the waiting fee is 100 THB per hour. Please give us your flight number when booking so we can set the pickup time correctly.',
  },
  {
    category: 'ค่าบริการเสริม',
    question: 'ต้องการเก้าอี้เด็ก คาร์ซีท ที่นั่งเด็ก ต้องจ่ายเพิ่มไหม มีกี่ตัว',
    answer: 'มีเก้าอี้เด็กให้ฟรีสูงสุด 2 ตัวครับ ถ้าต้องการมากกว่า 2 ตัว คิดเพิ่ม 100 บาท (ครั้งเดียวรวม ไม่คิดต่อตัว) รบกวนแจ้งจำนวนล่วงหน้าตอนจองครับ',
  },
  {
    category: 'Extra services',
    question: 'Do you provide child seats? Is it free? How many?',
    answer: 'Yes, up to 2 child seats are free. If you need more than 2, there is a single extra charge of 100 THB in total (not per seat). Please tell us how many you need when booking.',
  },
  {
    category: 'ค่าบริการเสริม',
    question: 'ต้องการล่าม บริการล่ามสื่อสาร คนขับพูดภาษาอื่นได้ไหม ค่าล่าม',
    answer: 'มีบริการล่ามสื่อสารครับ คิดเพิ่ม 600 บาทต่อรอบ รบกวนแจ้งภาษาที่ต้องการ พี่แชมป์จะยืนยันให้ครับ',
  },
  {
    category: 'Extra services',
    question: 'I need an interpreter or a driver who speaks my language. How much?',
    answer: 'An interpreter service is available for an extra 600 THB per trip. Please tell us the language you need and Champ will confirm.',
  },
  {
    category: 'ปัญหาหน้างาน',
    question: 'ขอเบอร์คนขับ เบอร์โทรคนขับ ติดต่อคนขับยังไง',
    answer: 'ติดต่อคนขับได้ที่เบอร์ +66 94 269 4651 ครับ เป็นเบอร์ของพี่แชมป์ซึ่งเป็นคนขับด้วย และจะประสานงานกับคนขับให้ครับ',
  },
  {
    category: 'On-site issues',
    question: 'Can I have the driver phone number? How do I contact my driver?',
    answer: 'You can reach your driver at +66 94 269 4651. This is Champ\'s number (Champ is also one of our drivers) and he will coordinate with the driver for you.',
  },
  {
    category: 'ผู้โดยสารพิเศษ',
    question: 'ผู้โดยสารเดินไม่ได้ ขอรถเข็น ผู้ป่วย ผู้สูงอายุ ผู้พิการ ต้องการความช่วยเหลือ',
    answer:
      'โดยปกติสายการบินมีบริการรถเข็นให้จนถึงรถตู้ของเราครับ หลังจากนั้นขึ้นอยู่กับทางโรงแรมว่ามีบริการรถเข็นให้หรือไม่ รบกวนแจ้งชื่อโรงแรมและรายละเอียดมาล่วงหน้า พี่แชมป์จะช่วยประสานงานครับ',
  },
  {
    category: 'Special passengers',
    question: 'A passenger cannot walk. Can you arrange a wheelchair? elderly disabled assistance',
    answer:
      'Normally the airline provides wheelchair service until the passenger boards our van. After that it depends on whether your hotel offers wheelchair service. Please tell us your hotel and details in advance and Champ will help coordinate.',
  },
  {
    category: 'ปัญหาหน้างาน',
    question: 'จุดนัดรับที่สนามบินกระบี่ รอตรงไหน ประตูไหน ทางออกไหน เจอกันที่ไหน',
    answer: 'จุดนัดรับที่สนามบินกระบี่คือ ประตูทาง 15 ครับ',
  },
  {
    category: 'On-site issues',
    question: 'Where is the meeting point at Krabi Airport? Which door or exit should I wait at?',
    answer: 'The meeting point at Krabi Airport is Door 15.',
  },
  {
    category: 'ประเภทรถ',
    question: 'ขอรูปรถ ดูรูปรถหน่อย รูปรถตู้ รูปรถ SUV',
    answer: 'ได้ครับ พี่แชมป์จะส่งรูปรถให้ทางแชทนี้นะครับ',
  },
  {
    category: 'Vehicle types',
    question: 'Can I see pictures of your vehicles? photos of the van or SUV',
    answer: 'Sure, Champ will send you photos of our vehicles in this chat.',
  },
  // ---- ความจุ / ประเภทรถ (แชมป์ยืนยัน 8 ต.ค. 2026: รถตู้นั่งสูงสุด 9 คน, มีรถทุกแบบ ทีมใหญ่ จัดรถเอง) ----
  {
    category: 'การรับ-ส่ง (Airport Transfer)',
    question: 'รถตู้นั่งได้กี่คนสูงสุด รถ 1 คันนั่งกี่คน ความจุผู้โดยสาร',
    answer: 'รถตู้ 1 คันนั่งผู้โดยสารได้สูงสุด 9 คนครับ ถ้าเกิน 9 คน พี่แชมป์จะจัดรถเพิ่มและแจ้งราคาให้ครับ',
  },
  {
    category: 'Airport Transfer',
    question: 'How many passengers can one van carry maximum seats capacity',
    answer: 'One van carries up to 9 passengers. For more than 9 passengers, Champ will arrange additional vehicles and quote the price for you.',
  },
  {
    category: 'ประเภทรถ',
    question: 'มีรถแบบไหนบ้าง รถตู้ SUV รถเก๋ง ขอรถประเภทอื่น',
    answer:
      'CTT มีรถหลายแบบครับ ทั้งรถตู้ SUV และรถเก๋ง ราคาในตารางรถรับ-ส่งเป็นราคารถตู้ ถ้าต้องการ SUV หรือรถเก๋ง พี่แชมป์จะจัดรถและแจ้งราคาให้ครับ (กลุ่ม 10-12 คนจัดได้ทั้งรถตู้ 2 คัน หรือรถตู้ + เก๋ง/SUV)',
  },
  {
    category: 'Vehicle types',
    question: 'What kind of vehicles do you have? van SUV sedan other vehicle types',
    answer:
      'CTT has a range of vehicles — vans, SUVs and sedans. The transfer price table is for vans. For an SUV or a sedan, Champ will arrange the vehicle and quote the price for you (groups of 10-12 can be served by two vans, or a van plus a sedan/SUV).',
  },
  {
    category: 'การรับ-ส่ง (Airport Transfer)',
    question: 'ไปกัน 12 คน กลุ่มใหญ่เกิน 9 คน ต้องใช้รถกี่คัน จัดรถยังไง',
    answer:
      'กลุ่มเกิน 9 คน CTT จัดให้ได้ 2 แบบครับ: รถตู้หลายคัน หรือรถตู้ 1 คันร่วมกับรถเก๋ง/SUV (เหมาะกับกลุ่ม 10-12 คน) แจ้งจุดรับ-ส่งและจำนวนคนมาได้เลยครับ',
  },
  {
    category: 'Airport Transfer',
    question: 'We are a group of 12 people more than 9 how many vehicles do we need',
    answer:
      'For groups of more than 9, CTT can arrange two options: multiple vans, or one van plus a sedan/SUV (suitable for groups of 10-12). Just tell us the pickup, drop-off and number of passengers.',
  },
  // ---- เช่ารถตู้พร้อมคนขับรายวัน กระบี่ (แชมป์ยืนยัน 8 ต.ค. 2026 — รวมน้ำมัน) ----
  // หมายเหตุ: ตัวเลขชุดนี้เป็นราคาขายลูกค้าอยู่แล้ว ไม่บวก 15% (แชมป์ยืนยัน 8 ต.ค. 2026 — ราคาทัวร์ก็เช่นกัน) ต่างจากราคารถรับ-ส่งในชีต Prices ที่เป็นราคา Agent
  {
    category: 'เช่ารถตู้รายวัน',
    question: 'เช่ารถตู้พร้อมคนขับรายวันราคาเท่าไหร่ กระบี่ 1 วัน กี่บาท 8 ชั่วโมง 10 ชั่วโมง 12 ชั่วโมง ไม่รวมน้ำมัน',
    answer:
      'เช่ารถตู้พร้อมคนขับในจังหวัดกระบี่ (ราคาต่อรถ 1 คัน รวมน้ำมันแล้ว): 8 ชั่วโมง 2,500 บาท • 10 ชั่วโมง 3,000 บาท • 12 ชั่วโมง 3,500 บาทครับ ไม่มีแพ็กเกจแยกแบบไม่รวมน้ำมัน',
  },
  {
    category: 'Daily van rental',
    question: 'How much is a van with driver per day in Krabi? 8 hours 10 hours 12 hours fuel included or not',
    answer:
      'Van with driver in Krabi province (price per van, fuel included): 8 hours 2,500 THB • 10 hours 3,000 THB • 12 hours 3,500 THB. There is no separate fuel-excluded package.',
  },
  // ---- ช่องทางติดต่อ (CLAUDE.md §5) ----
  {
    category: 'ข้อมูลการติดต่อ',
    question: 'มีช่องทางติดต่ออื่นนอกจาก LINE ไหม ขอเบอร์โทร อีเมล โซเชียล ช่องทางอื่น',
    answer:
      'ติดต่อ CTT ได้หลายช่องทางครับ: LINE @ctt.trip365 • WhatsApp/โทร +66 94 269 4651 • อีเมล ctt.trip365@gmail.com • Instagram ctt.trip365 • TikTok @ctt.trip365 • Facebook เพจ CTT • WeChat h950r321 (ช่องทางที่เร็วที่สุดคือ LINE และ WhatsApp)',
  },
  {
    category: 'Contact',
    question: 'What other ways can I contact you? phone email social media other channels',
    answer:
      'You can reach CTT via LINE @ctt.trip365, WhatsApp/phone +66 94 269 4651, email ctt.trip365@gmail.com, Instagram ctt.trip365, TikTok @ctt.trip365, the CTT Facebook page, or WeChat h950r321. LINE and WhatsApp are the fastest.',
  },
  // ---- ขอร่วมงาน / เอเจนต์ / รถวิ่งร่วม ----
  {
    category: 'ความร่วมมือ',
    question: 'สนใจร่วมงาน เป็นรถวิ่งร่วม เป็นเอเจนต์ ขอวางคอนแทค ขอวิ่งงานกับ CTT',
    answer:
      'ขอบคุณที่สนใจร่วมงานกับ CTT ครับ รบกวนส่งรายละเอียด (ชื่อ/บริษัท พื้นที่ให้บริการ จำนวนและประเภทรถ เบอร์ติดต่อ) มาที่อีเมล ctt.trip365@gmail.com หรือ WhatsApp +66 94 269 4651 พี่แชมป์เจ้าของจะติดต่อกลับครับ',
  },
  {
    category: 'Partnership',
    question: 'I am interested in partnering as an agent or as a driver with my own vehicle working with CTT',
    answer:
      'Thank you for your interest in working with CTT. Please send your details (name/company, service area, number and type of vehicles, contact number) to ctt.trip365@gmail.com or WhatsApp +66 94 269 4651 and Champ, the owner, will get back to you.',
  },
  // ---- เร่งด่วนหน้างาน ----
  {
    category: 'ปัญหาหน้างาน',
    question: 'ฉันรออยู่ที่สนามบินแล้ว รถยังไม่มา หาคนขับไม่เจอ รถจะมาอีกกี่นาที ตอนนี้คนขับอยู่ไหน',
    answer:
      'ขออภัยในความไม่สะดวกครับ กรณีเร่งด่วนหน้างาน (รอรถ หาคนขับไม่เจอ รถล่าช้า) รบกวนโทรหรือ WhatsApp พี่แชมป์ที่ +66 94 269 4651 ทันที เพื่อให้ตามคนขับให้เร็วที่สุดครับ น้องอันดาไม่เห็นตำแหน่งรถแบบเรียลไทม์ จึงบอกเวลาที่แน่นอนไม่ได้ครับ',
  },
  {
    category: 'On-site issues',
    question: 'I am waiting at the airport and cannot find my driver. How many minutes until the car arrives?',
    answer:
      'Sorry for the inconvenience. For urgent on-site issues (waiting for a car, cannot find the driver, delays) please call or WhatsApp Champ immediately at +66 94 269 4651 so we can reach your driver as fast as possible. I cannot see live vehicle locations, so I cannot give an exact arrival time.',
  },
];
