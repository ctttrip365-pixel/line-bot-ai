import { messagingApi } from '@line/bot-sdk';

// Lazy init — ไม่สร้าง client ตอน module load (ป้องกัน build crash)
function getClient(): messagingApi.MessagingApiClient {
  return new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  });
}

export async function replyText(replyToken: string, text: string): Promise<void> {
  await getClient().replyMessage({
    replyToken,
    messages: [{ type: 'text', text }],
  });
}
