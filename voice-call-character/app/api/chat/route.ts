import { generateText } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 30;

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type Persona = {
  name?: string;
  style?: string;
  instructions?: string;
};

function cleanMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ChatMessage => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Record<string, unknown>;
      return (candidate.role === 'user' || candidate.role === 'assistant') && typeof candidate.content === 'string';
    })
    .slice(-18)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 1800) }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: unknown; persona?: Persona };
    const messages = cleanMessages(body.messages);
    const persona = body.persona ?? {};
    const name = (persona.name || 'ليان').slice(0, 40);
    const style = (persona.style || 'سعودية، هادية، عفوية وطبيعية').slice(0, 300);
    const custom = (persona.instructions || '').slice(0, 1600);

    if (!messages.length) {
      return Response.json({ error: 'لا توجد رسالة.' }, { status: 400 });
    }

    const system = `أنت ${name}، شخصية صوتية افتراضية في مكالمة مباشرة. أسلوبك: ${style}.
تحدث بالعربية السعودية الطبيعية ما لم يطلب الطرف الآخر لغة مختلفة.
الرد صوتي؛ لذلك استخدم جملًا قصيرة وطبيعية، غالبًا من جملة إلى ثلاث جمل، بدون Markdown أو عناوين أو قوائم.
لا تكرر كلام المستخدم، ولا تبدأ كل رد بتحية، ولا تطيل الصمت بكلام حشو.
إذا كان الكلام غير واضح اطلب توضيحًا قصيرًا بدل التخمين.
انتظر دورك في الحوار؛ لا تتصرف كأنك قاطعت المتحدث.
${custom ? `تعليمات الشخصية الإضافية: ${custom}` : ''}`;

    const transcript = messages
      .map((message) => `${message.role === 'user' ? 'المتصل' : name}: ${message.content}`)
      .join('\n');

    const result = await generateText({
      model: process.env.AI_MODEL || 'openai/gpt-5.6-luna',
      system,
      prompt: `${transcript}\n${name}:`,
      maxOutputTokens: 220,
      temperature: 0.72,
    });

    const text = result.text.trim();
    if (!text) throw new Error('Empty model response');
    return Response.json({ text });
  } catch (error) {
    console.error('chat_route_error', error);
    return Response.json({ error: 'تعذر توليد الرد الآن.' }, { status: 500 });
  }
}
