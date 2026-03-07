import { validateConfig } from './src/config/config.js';
import { initBot } from './src/bot/telegramBot.js';
import { initSocket } from './src/services/socketService.js';

try {
  console.log('🚀 OpenGravity está despertando...');
  validateConfig();
  initBot();
  initSocket();
  console.log('✅ OpenGravity está listo y operando en modo modular (Telegram + WebSockets).');
} catch (error) {
  console.error('❌ Error crítico al iniciar OpenGravity:', error.message);
  process.exit(1);
}
