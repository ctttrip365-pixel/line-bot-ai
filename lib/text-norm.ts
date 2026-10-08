// lib/text-norm.ts — ทำชื่อสถานที่ให้เทียบกันได้ (ใช้ร่วมกันระหว่าง prices.ts และ place-zones.ts)
// "สนามบิน ภูเก็ต" / "Phuket-Airport" / "phuket airport " → ตัวพิมพ์เล็ก ตัดช่องว่างและเครื่องหมาย

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[\s\-_.,()/]+/g, '')
    .trim();
}
