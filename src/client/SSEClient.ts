/**
 * SSE 事件的数据结构
 */
export interface SSEEvent {
  type: string;
  data: string; // 服务器发来的 data 都是字符串，必要时自行 JSON.parse
}

/**
 * 专门用于发起“生成视频”的 SSE 请求。
 * 参数:
 *   - prompt: 要讲解的主题文本
 *   - provider: 比如 "openrouter"
 *   - voice_provider: 比如 "openai"
 *   - voice_id: 比如 "shimmer"
 *   - language: "zh" / "en"
 *   - user_id: 从 UserIdConst.TONG_LI 拿
 *   - onEvent: 回调每次收到 SSE event 时触发
 */
export async function sendVideoSSERequest(options: {
  question: string;
  provider: string;
  voice_provider: string;
  voice_id: string;
  language: string;
  user_id: string;
  onEvent: (event: SSEEvent) => void;
}) {
  const {
    question,
    provider,
    voice_provider,
    voice_id,
    language,
    user_id,
    onEvent,
  } = options;

  // 假设后端的 SSE endpoint 就是这个 URL
  const url = import.meta.env.VITE_BACKEND_BASE_URL + '/api/explanation/video';
  const body = {
    question,
    provider,
    voice_provider,
    voice_id,
    language,
    user_id,
    generate_type:1,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error('Network error or no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onEvent({ type: 'done', data: '' });
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    // SSE 通常以 “\r\n\r\n” 分隔每个 event
    const parts = buffer.split('\r\n\r\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      const event = parseSSEEvent(part);
      if (event) {
        onEvent(event);
      }
    }
  }
}

/**
 * 把原始 SSE 段落 (“event:xxx\ndata:yyy\n\n”) 解析成 { type, data }
 */
function parseSSEEvent(raw: string): SSEEvent | null {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  let eventType = 'message';
  let dataStr = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.substring('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataStr += line.substring('data:'.length).trim();
    }
  }

  if (dataStr) {
    return { type: eventType, data: dataStr };
  }
  return null;
}

