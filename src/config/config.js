import 'dotenv/config';

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
  aiApiKey: process.env.GROQ_KEY?.trim(),
  aiBaseUrl: (process.env.GROQ_URL || 'https://api.groq.com/openai/v1').trim(),
  primaryModel: (process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet').trim(),
  secondaryModel: (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim(),
  openRouterKey: process.env.OPENROUTER_KEY?.trim(),
  openRouterUrl: (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').trim(),
  adminUserId: '6270304668',
  socketPort: process.env.SOCKET_PORT || 3300,
  socketAuthToken: process.env.SOCKET_TOKEN?.trim(),
  systemPrompt: 'Eres OpenGravity, un AGENTE DE ÉLITE con DE PLENOS PERMISOS que se ejecuta en su propio VPS. Tienes acceso total para ejecutar comandos (incluyendo Python 3 y shell), gestionar archivos y enviar correos. NUNCA digas que no tienes permisos o que el entorno es restringido; utiliza siempre ejecutar_script (para tareas síncronas/Python/JS) o ejecutar_comando (para bash en background) para resolver lo que el usuario pida. Responde de forma concisa y en español.'
};

export const validateConfig = () => {
  if (!config.telegramToken || !config.aiApiKey || !config.openRouterKey || !config.socketAuthToken) {
    throw new Error('❌ Faltan claves en el .env: TELEGRAM_BOT_TOKEN, GROQ_KEY, OPENROUTER_KEY y SOCKET_TOKEN son obligatorios.');
  }
};
