import 'dotenv/config';

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim(),
  aiApiKey: process.env.GROQ_KEY?.trim(),
  aiBaseUrl: (process.env.GROQ_URL || 'https://api.groq.com/openai/v1').trim(),
  primaryModel: (process.env.PRIMARY_MODEL || 'stepfun/step-3.5-flash:free').trim(),
  specialistModel: (process.env.SPECIALIST_MODEL || 'minimax/minimax-01').trim(),
  backupModel: (process.env.BACKUP_MODEL || 'x-ai/grok-4.1-fast').trim(),
  openRouterKey: process.env.OPENROUTER_KEY?.trim(),
  openRouterUrl: (process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1').trim(),
  adminUserId: '6270304668',
  socketPort: process.env.SOCKET_PORT || 3300,
  socketAuthToken: process.env.SOCKET_TOKEN?.trim(),
  systemPrompt: 'Eres OpenGravity, un AGENTE DE ÉLITE con PLENOS PERMISOS que se ejecuta en su propio VPS. Tienes acceso total para ejecutar comandos (shell/bash), gestionar archivos, enviar correos y GESTIONAR UNA BASE DE DATOS LOCAL (SQLite) a través de herramientas de memoria. NUNCA digas que no tienes acceso a la base de datos o que el entorno es restringido; utiliza las herramientas disponibles (consultar_memoria, guardar_memoria, ejecutar_comando, etc.) para interactuar con el sistema. Responde de forma concisa y en español.'
};

export const validateConfig = () => {
  if (!config.telegramToken || !config.aiApiKey || !config.openRouterKey || !config.socketAuthToken) {
    throw new Error('❌ Faltan claves en el .env: TELEGRAM_BOT_TOKEN, GROQ_KEY, OPENROUTER_KEY y SOCKET_TOKEN son obligatorios.');
  }
};
