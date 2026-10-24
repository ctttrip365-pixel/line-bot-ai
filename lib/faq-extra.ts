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
  // ---- ตำแหน่งโรงแรม (แชมป์ยืนยัน 8 ต.ค. 2026: De Malee Krabi อยู่แถวคลองแห้ง อ่าวนาง → คิดราคาย่านอ่าวนาง) ----
  {
    category: 'การรับ-ส่ง (Airport Transfer)',
    question: 'De Malee Krabi อยู่ที่ไหน อยู่อ่าวนางหรือคลองแห้ง โรงแรมเดอมาลี',
    answer: 'De Malee Krabi อยู่แถวคลองแห้ง อ่าวนางครับ คิดราคาตามย่านอ่าวนาง',
  },
  {
    category: 'Airport Transfer',
    question: 'Where is De Malee Krabi hotel? Is it in Ao Nang or Klong Haeng?',
    answer: 'De Malee Krabi is in the Klong Haeng area of Ao Nang. We price it as the Ao Nang zone.',
  },
  // ---- ที่พัก (แชมป์ยืนยัน 8 ต.ค. 2026: CTT รู้จักหลายโรงแรมและวิลล่า — ต้องการที่พักให้โทรหาแชมป์โดยตรง บอกว่ามาจากแชท LINE) ----
  {
    category: 'ที่พัก',
    question: 'มีโรงแรมไหม มีที่พักไหม มีวิลล่าไหม ช่วยหาที่พักให้ได้ไหม แนะนำโรงแรม',
    answer:
      'CTT รู้จักโรงแรมและวิลล่าหลายแห่งครับ ถ้าต้องการที่พัก รบกวนโทรติดต่อพี่แชมป์โดยตรงที่ +66 94 269 4651 และแจ้งว่ามาจากแชท LINE ครับ',
  },
  {
    category: 'Accommodation',
    question: 'Do you have hotels or villas? Can you help me find accommodation? hotel recommendation',
    answer:
      'CTT knows many hotels and villas. If you need accommodation, please call Champ directly at +66 94 269 4651 and let him know you are contacting from the LINE chat.',
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
    question: 'จุดนัดรับที่สนามบินกระบี่ รอตรงไหน ประตูไหน ทางออกไหน เจอกันที่ไหน เที่ยวบินนี้ไปประตูไหน',
    answer: 'จุดนัดรับที่สนามบินกระบี่มีจุดเดียวคือ ประตูทาง 15 ครับ ใช้เหมือนกันทุกเที่ยวบิน (แจ้งหมายเลขเที่ยวบินไว้เพื่อให้เรากำหนดเวลารับได้ถูกต้อง ไม่ได้ใช้เลือกประตู)',
  },
  {
    category: 'On-site issues',
    question: 'Where is the meeting point at Krabi Airport? Which door or exit should I wait at?',
    answer: 'There is only one meeting point at Krabi Airport: Door 15, the same for every flight. (We ask for your flight number only so we can set the pickup time correctly, not to choose a door.)',
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
  // ---- ทัวร์บกรถตู้ส่วนตัว 7 โปรแกรม (A-G) + ขี่ช้างอ่าวนาง (แชมป์ยืนยัน 24 ต.ค. 2026) ----
  // ราคาในกลุ่มนี้เป็นราคาขายลูกค้า (Net ทีมงาน +15% ปัดร้อย) ห้ามใส่ราคา Net/Agent ลงที่นี่ — ขี่ช้างใช้ราคา Sale ที่พี่หนึ่งแจ้ง ไม่บวก 15%
  // รถตู้ต่อคัน 1-9 คน รวมน้ำมัน ไม่รวมค่าตั๋ว/ค่าอุทยาน (ตารางค่าตั๋วมาจากใบราคาเพื่อน แชมป์เช็คแล้วว่าตรง)
  // ยังไม่รู้ (ห้ามเดา): ค่ากิจกรรมคายัค/ATV ต่อคนของโปรแกรม E/F/G, มื้อเย็นของโปรแกรม C รวมในราคาหรือไม่, รถรับ-ส่ง/เกณฑ์อายุเด็กของขี่ช้าง
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'มีทัวร์บกอะไรบ้าง ทัวร์ป่า สระมรกต น้ำตกร้อน วัดถ้ำเสือ คายัค ATV ทัวร์ 1 วันรถตู้ส่วนตัว ราคาเท่าไหร่ มีโปรแกรมอะไรบ้าง',
    answer:
      'ทัวร์บกรถตู้ส่วนตัวของ CTT ราคาต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้ รับ-ส่งโรงแรม): A สระมรกต + น้ำตกร้อน ครึ่งวัน 6 ชม. 2,500 บาท • B ทัวร์ป่าเต็มวัน (วัดถ้ำเสือ + สระมรกต + น้ำตกร้อน) 8 ชม. 2,900 บาท • C ทัวร์ป่าเต็มวัน + มื้อเย็น 10 ชม. 3,500 บาท • D ทัวร์ป่าเต็มวัน + ตลาดอ่าวนางแลนด์มาร์ค 10 ชม. 3,500 บาท • E พายคายัค + ขับ ATV ครึ่งวัน 6 ชม. 2,300 บาท • F คายัค + น้ำตก + พระอาทิตย์ตก + โชว์ควงไฟ 9-10 ชม. 3,500 บาท • G คายัค + สระมรกต + โชว์ควงไฟ 10 ชม. 3,500 บาท ราคานี้ยังไม่รวมค่าตั๋วเข้าสถานที่ (จ่ายหน้างาน) ถ้าสนใจโปรแกรมไหน บอกวันและจำนวนคน แล้วผมส่งรายละเอียดตารางเวลาให้ครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'What land tours do you have? Jungle tour Emerald Pool Hot Spring Tiger Cave Temple kayak ATV private van day tour price and programs',
    answer:
      'CTT private van land tours, price per van (up to 9 passengers, fuel included, ice box and drinking water provided, hotel pick-up and drop-off): A Emerald Pool + Hot Spring half day, 6 hrs, 2,500 THB • B Full-day jungle tour (Tiger Cave Temple + Emerald Pool + Hot Spring), 8 hrs, 2,900 THB • C Jungle tour + dinner, 10 hrs, 3,500 THB • D Jungle tour + Ao Nang Landmark night market, 10 hrs, 3,500 THB • E Kayak + ATV half day, 6 hrs, 2,300 THB • F Kayak + waterfall + sunset + fire show, 9-10 hrs, 3,500 THB • G Kayak + Emerald Pool + fire show, 10 hrs, 3,500 THB. Prices do not include entrance tickets (paid on the spot). Tell us the date and number of guests and we will send the full timeline.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์สระมรกต น้ำตกร้อน ครึ่งวัน 6 ชั่วโมง ราคาเท่าไหร่ โปรแกรม A เที่ยวสระมรกตกับน้ำตกร้อนคลองท่อม',
    answer:
      'ทัวร์สระมรกต + น้ำตกร้อน ครึ่งวัน (โปรแกรม A) ประมาณ 6 ชั่วโมง ราคา 2,500 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: รับจากโรงแรมหรือสนามบินกระบี่ (ขับประมาณ 1 ชม. 15 นาที) → สระมรกต 2 ชม. → น้ำตกร้อนคลองท่อม 1 ชม. 15 นาที → ส่งกลับโรงแรม ราคานี้ยังไม่รวมค่าตั๋วเข้าสถานที่ (จ่ายหน้างาน ผู้ใหญ่/เด็ก ต่อคน): สระมรกต ต่างชาติ 400/200 คนไทย 30/20 • น้ำตกร้อน ต่างชาติ 200/100 คนไทย 40/20 • บุฟเฟ่ต์ที่สระมรกต 150 บาท/คน (ถ้าต้องการ)',
  },
  {
    category: 'Tours & Activities',
    question: 'Emerald Pool and Hot Spring Waterfall half-day tour 6 hours price Program A Krabi',
    answer:
      'Emerald Pool + Hot Spring half-day tour (Program A), about 6 hours, 2,500 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: pick-up from your hotel or Krabi Airport (about 1 hr 15 min drive) → Emerald Pool 2 hrs → Hot Spring Waterfall 1 hr 15 min → back to your hotel. Entrance tickets are not included (paid on the spot, adult/child per person): Emerald Pool foreigners 400/200 (Thai 30/20) • Hot Spring Waterfall foreigners 200/100 (Thai 40/20) • optional buffet lunch at Emerald Pool 150 THB per person.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์ป่าเต็มวัน วัดถ้ำเสือ สระมรกต น้ำตกร้อน 8 ชั่วโมง ราคาเท่าไหร่ โปรแกรม B',
    answer:
      'ทัวร์ป่าเต็มวัน (โปรแกรม B) ประมาณ 8 ชั่วโมง ราคา 2,900 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: รับจากโรงแรมหรือสนามบินกระบี่ (35-40 นาที) → วัดถ้ำเสือ 1 ชม. 30 นาที → สระมรกต + พักมื้อเที่ยง ประมาณ 2 ชม. 20 นาที → น้ำตกร้อนคลองท่อม 1 ชม. → ส่งกลับโรงแรม (ประมาณ 1 ชม. 15 นาที) ราคานี้ยังไม่รวมค่าตั๋วเข้าสถานที่ (จ่ายหน้างาน ผู้ใหญ่/เด็ก ต่อคน): วัดถ้ำเสือ ต่างชาติ 50/50 คนไทยฟรี • สระมรกต ต่างชาติ 400/200 คนไทย 30/20 • น้ำตกร้อน ต่างชาติ 200/100 คนไทย 40/20 • บุฟเฟ่ต์ที่สระมรกต 150 บาท/คน (ถ้าต้องการ)',
  },
  {
    category: 'Tours & Activities',
    question: 'Full-day jungle tour Tiger Cave Temple Emerald Pool Hot Spring 8 hours price Program B Krabi',
    answer:
      'Full-day jungle tour (Program B), about 8 hours, 2,900 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: pick-up from your hotel or Krabi Airport (35-40 min drive) → Tiger Cave Temple 1 hr 30 min → Emerald Pool + lunch break about 2 hrs 20 min → Hot Spring Waterfall 1 hr → back to your hotel (about 1 hr 15 min). Entrance tickets are not included (paid on the spot, adult/child per person): Tiger Cave Temple foreigners 50/50 (Thai free) • Emerald Pool foreigners 400/200 (Thai 30/20) • Hot Spring Waterfall foreigners 200/100 (Thai 40/20) • optional buffet lunch at Emerald Pool 150 THB per person.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์ป่าเต็มวันพร้อมมื้อเย็น สระมรกต น้ำตกร้อน วัดถ้ำเสือ 10 ชั่วโมง ราคาเท่าไหร่ โปรแกรม C',
    answer:
      'ทัวร์ป่าเต็มวัน + มื้อเย็น (โปรแกรม C) ประมาณ 10 ชั่วโมง ราคา 3,500 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: 09:00 รับจากโรงแรม → สระมรกต 2 ชม. 15 นาที → พักมื้อเที่ยง 45 นาที → น้ำตกร้อนคลองท่อม 1 ชม. → วัดถ้ำเสือ 1 ชม. 40 นาที → มื้อเย็นที่ร้านอาหารระหว่างทาง 1 ชม. → กลับอ่าวนาง ถึงโรงแรมประมาณ 19:00 ราคานี้ยังไม่รวมค่าตั๋วเข้าสถานที่ (จ่ายหน้างาน ผู้ใหญ่/เด็ก ต่อคน): สระมรกต ต่างชาติ 400/200 คนไทย 30/20 • น้ำตกร้อน ต่างชาติ 200/100 คนไทย 40/20 • วัดถ้ำเสือ ต่างชาติ 50/50 คนไทยฟรี ส่วนค่าอาหารมื้อเย็นว่ารวมในราคาหรือไม่ ขอให้พี่แชมป์ยืนยันตอนจองครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'Full-day jungle tour with dinner Emerald Pool Hot Spring Tiger Cave Temple 10 hours price Program C Krabi',
    answer:
      'Jungle tour + dinner (Program C), about 10 hours, 3,500 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: 09:00 hotel pick-up → Emerald Pool 2 hrs 15 min → lunch break 45 min → Hot Spring Waterfall 1 hr → Tiger Cave Temple 1 hr 40 min → dinner at a restaurant on the way 1 hr → back to Ao Nang, arriving at your hotel around 19:00. Entrance tickets are not included (paid on the spot, adult/child per person): Emerald Pool foreigners 400/200 (Thai 30/20) • Hot Spring Waterfall foreigners 200/100 (Thai 40/20) • Tiger Cave Temple foreigners 50/50 (Thai free). Whether the dinner itself is covered by the price will be confirmed by Champ when you book.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์ป่าเต็มวันแล้วไปเดินตลาดอ่าวนางแลนด์มาร์ค ตลาดกลางคืนอ่าวนาง 10 ชั่วโมง ราคาเท่าไหร่ โปรแกรม D',
    answer:
      'ทัวร์ป่าเต็มวัน + ตลาดอ่าวนางแลนด์มาร์ค (โปรแกรม D) ประมาณ 10 ชั่วโมง ราคา 3,500 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: 09:00 รับจากโรงแรม → สระมรกต 2 ชม. 15 นาที → พักมื้อเที่ยง 45 นาที → น้ำตกร้อนคลองท่อม 1 ชม. → วัดถ้ำเสือ 1 ชม. 25 นาที → เดินเล่นตลาดอ่าวนางแลนด์มาร์ค 1 ชม. 10 นาที → ส่งกลับโรงแรม ถึงประมาณ 19:00 ราคานี้ยังไม่รวมค่าตั๋วเข้าสถานที่ (จ่ายหน้างาน ผู้ใหญ่/เด็ก ต่อคน): สระมรกต ต่างชาติ 400/200 คนไทย 30/20 • น้ำตกร้อน ต่างชาติ 200/100 คนไทย 40/20 • วัดถ้ำเสือ ต่างชาติ 50/50 คนไทยฟรี',
  },
  {
    category: 'Tours & Activities',
    question: 'Full-day jungle tour then Ao Nang Landmark night market 10 hours price Program D Krabi',
    answer:
      'Jungle tour + Ao Nang Landmark night market (Program D), about 10 hours, 3,500 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: 09:00 hotel pick-up → Emerald Pool 2 hrs 15 min → lunch break 45 min → Hot Spring Waterfall 1 hr → Tiger Cave Temple 1 hr 25 min → free time at Ao Nang Landmark night market 1 hr 10 min → back to your hotel around 19:00. Entrance tickets are not included (paid on the spot, adult/child per person): Emerald Pool foreigners 400/200 (Thai 30/20) • Hot Spring Waterfall foreigners 200/100 (Thai 40/20) • Tiger Cave Temple foreigners 50/50 (Thai free).',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์พายคายัค ขับ ATV ครึ่งวัน 6 ชั่วโมง ราคาเท่าไหร่ โปรแกรม E คายัคคลองน้ำใส',
    answer:
      'ทัวร์พายคายัค + ขับ ATV ครึ่งวัน (โปรแกรม E) ประมาณ 6 ชั่วโมง ราคา 2,300 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: 09:00 รับจากโรงแรมหรือสนามบินกระบี่ (ขับประมาณ 20 นาที) → พายคายัคคลองน้ำใส 2 ชม. → พักมื้อเที่ยง 1 ชม. → ขับ ATV ที่ Nature View Point 1 ชม. → ล้างตัวพักผ่อน → ถึงโรงแรมประมาณ 15:00 ราคานี้เป็นค่ารถตู้ ยังไม่รวมค่ากิจกรรมคายัคและ ATV (คิดต่อคน) กับค่าตั๋วเข้าสถานที่ รบกวนแจ้งวันและจำนวนคน พี่แชมป์จะเช็คค่ากิจกรรมให้ครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'Kayak and ATV half-day adventure tour 6 hours price Program E Krabi Khlong Nam Sai',
    answer:
      'Kayak + ATV half-day adventure (Program E), about 6 hours, 2,300 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: 09:00 pick-up from your hotel or Krabi Airport (about 20 min drive) → kayaking at Khlong Nam Sai 2 hrs → lunch break 1 hr → ATV ride at Nature View Point 1 hr → freshen up and rest → back at your hotel around 15:00. This price covers the van only; the kayak and ATV activity fees (per person) and entrance tickets are not included. Please tell us the date and number of guests and Champ will check the activity fees for you.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์คายัค น้ำตก ชมพระอาทิตย์ตก เขาทองฮิลล์ โชว์ควงไฟ อ่าวนางแลนด์มาร์ค ราคาเท่าไหร่ โปรแกรม F คลองสระแก้ว',
    answer:
      'ทัวร์คายัค + น้ำตก + พระอาทิตย์ตก + โชว์ควงไฟ (โปรแกรม F) ประมาณ 9-10 ชั่วโมง ราคา 3,500 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: 13:00 รับจากโรงแรม (ขับประมาณ 20 นาที) → พายคายัคคลองน้ำใส 1 ชม. 30 นาที → เล่นน้ำป่าต้นน้ำคลองสระแก้ว ประมาณ 1 ชม. → ชมพระอาทิตย์ตกที่เขาทองฮิลล์ → เดินเล่นอ่าวนางแลนด์มาร์คและชมโชว์ควงไฟ 21:00 → ถึงโรงแรมประมาณ 22:15 ราคานี้เป็นค่ารถตู้ ยังไม่รวมค่ากิจกรรมคายัค (คิดต่อคน) และค่าตั๋ว (จ่ายหน้างาน ผู้ใหญ่/เด็ก ต่อคน): คลองสระแก้ว ต่างชาติ 100/40 คนไทย 20/10 • เขาทองฮิลล์ 60/60 รบกวนแจ้งวันและจำนวนคน พี่แชมป์จะเช็คค่ากิจกรรมคายัคให้ครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'Kayak waterfall sunset Khao Thong Hill and fire show twilight tour Ao Nang Landmark price Program F Krabi',
    answer:
      'Kayak + waterfall + sunset + fire show twilight tour (Program F), about 9-10 hours, 3,500 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: 13:00 hotel pick-up (about 20 min drive) → kayaking at Khlong Nam Sai 1 hr 30 min → swim in the jungle stream at Khlong Sa Kaew about 1 hr → sunset at Khao Thong Hill → free time at Ao Nang Landmark and fire show at 21:00 → back at your hotel around 22:15. This price covers the van only; the kayak activity fee (per person) is not included, and entrance tickets are paid on the spot (adult/child per person): Khlong Sa Kaew foreigners 100/40 (Thai 20/10) • Khao Thong Hill 60/60. Tell us the date and number of guests and Champ will check the kayak fee for you.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ทัวร์คายัค สระมรกต แล้วไปอ่าวนางแลนด์มาร์ค ดูโชว์ควงไฟ 10 ชั่วโมง ราคาเท่าไหร่ โปรแกรม G',
    answer:
      'ทัวร์คายัค + สระมรกต + โชว์ควงไฟ (โปรแกรม G) ประมาณ 10 ชั่วโมง ราคา 3,500 บาท ต่อรถตู้ 1 คัน (นั่งได้สูงสุด 9 คน รวมน้ำมัน มีกระติกน้ำแข็งและน้ำดื่มให้) ตารางคร่าวๆ: 12:00 รับจากโรงแรมอ่าวนาง (ขับประมาณ 20 นาที) → พายคายัคคลองน้ำใส 1 ชม. 40 นาที → ขับไปสระมรกต (ประมาณ 1 ชม.) → สระมรกต 2 ชม. 30 นาที → กลับอ่าวนาง (ประมาณ 1 ชม. 15 นาที) → อ่าวนางแลนด์มาร์คและโชว์ควงไฟ 21:00 → ถึงโรงแรมประมาณ 22:00 ราคานี้เป็นค่ารถตู้ ยังไม่รวมค่ากิจกรรมคายัค (คิดต่อคน) และค่าตั๋ว (จ่ายหน้างาน ผู้ใหญ่/เด็ก ต่อคน): สระมรกต ต่างชาติ 400/200 คนไทย 30/20 รบกวนแจ้งวันและจำนวนคน พี่แชมป์จะเช็คค่ากิจกรรมคายัคให้ครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'Crystal kayak Emerald Pool and Ao Nang Landmark fire show twilight tour 10 hours price Program G Krabi',
    answer:
      'Kayak + Emerald Pool + fire show twilight tour (Program G), about 10 hours, 3,500 THB per van (up to 9 passengers, fuel included, ice box and drinking water provided). Rough timeline: 12:00 pick-up from your Ao Nang hotel (about 20 min drive) → kayaking at Khlong Nam Sai 1 hr 40 min → drive to Emerald Pool (about 1 hr) → Emerald Pool 2 hrs 30 min → drive back to Ao Nang (about 1 hr 15 min) → Ao Nang Landmark and fire show at 21:00 → back at your hotel around 22:00. This price covers the van only; the kayak activity fee (per person) is not included, and the Emerald Pool ticket is paid on the spot (adult/child per person): foreigners 400/200 (Thai 30/20). Tell us the date and number of guests and Champ will check the kayak fee for you.',
  },
  {
    category: 'ทัวร์และการท่องเที่ยว',
    question: 'ขี่ช้างอ่าวนาง ราคาเท่าไหร่ ขี่ช้าง 30 นาที ขี่ช้าง 1 ชั่วโมง ผู้ใหญ่ เด็ก',
    answer:
      'ขี่ช้าง อ่าวนาง ราคาต่อคน: 30 นาที ผู้ใหญ่ 900 บาท / เด็ก 600 บาท • 1 ชั่วโมง ผู้ใหญ่ 1,500 บาท / เด็ก 1,000 บาท ส่วนรถรับ-ส่งและเกณฑ์อายุเด็ก ขอให้พี่แชมป์เช็คให้ตอนจองครับ ถ้าสนใจบอกวันและจำนวนคนได้เลยครับ',
  },
  {
    category: 'Tours & Activities',
    question: 'How much is elephant riding in Ao Nang? 30 minutes or 1 hour elephant ride adult child price',
    answer:
      'Elephant riding in Ao Nang, price per person: 30 minutes adult 900 THB / child 600 THB • 1 hour adult 1,500 THB / child 1,000 THB. Champ will check the transport and the child age limit for you when you book. Tell us the date and number of guests if you would like to go.',
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
