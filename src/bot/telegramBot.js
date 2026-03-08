import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/config.js';
import { aiService } from '../services/aiService.js';
import { saveMessage, getHistory } from '../database/database.js';

export let botInstance = null;

export const initBot = () => {
  const bot = new TelegramBot(config.telegramToken, { polling: true });
  botInstance = bot;

  const sanitizeMarkdown = (text) => {
    if (!text) return '';
    // Eliminar etiquetas tipo <tool_call> que rompen el parser
    // No escapamos caracteres normales para evitar visual clutter (\. \: \( etc)
    return text.replace(/<[^>]*>/g, '').trim();
  };

  const processMessage = async (chatId, userId, text, fromName) => {
    try {
      // Guardar mensaje del usuario
      saveMessage(userId, 'user', text);

      // Obtener historial (excluyendo el mensaje actual que acabamos de guardar para pasarlo aparte)
      const history = getHistory(userId, 15);
      // Nota: getHistory nos da los últimos 15 incluyendo el que acabamos de guardar al final.
      // aiService.getChatCompletion lo añadirá de nuevo si no tenemos cuidado.
      // Vamos a filtrar el último mensaje del historial para evitar duplicados en el prompt.
      const conversationHistory = history.slice(0, -1);

      // Procesar con IA
      const { content, model } = await aiService.getChatCompletion(userId, text, conversationHistory);
      console.log(`📤 Enviando respuesta a ${chatId}: ${content?.substring(0, 50)}...`);
      
      // Guardar respuesta de la IA
      saveMessage(userId, 'assistant', content);
      
      if (content && content.trim()) {
        const header = `🤖 *[${model}]*`;
        const safeContent = sanitizeMarkdown(content);
        // Intentar enviar con Markdown, si falla, enviar texto plano
        try {
          await bot.sendMessage(chatId, `${header}\n${safeContent}`, { parse_mode: 'Markdown' });
        } catch (markdownError) {
          console.warn('⚠️ Fallo al enviar Markdown, reintentando como texto plano:', markdownError.message);
          await bot.sendMessage(chatId, `🤖 [${model}]\n${content}`);
        }
      } else {
        console.warn('⚠️ La IA devolvió una respuesta vacía. Enviando mensaje por defecto.');
        bot.sendMessage(chatId, '✅ Entendido. He procesado tu solicitud.');
      }
    } catch (error) {
      console.error('❌ Error procesando mensaje:', error.message);
      bot.sendMessage(chatId, 'Lo siento, hubo un error al procesar tu solicitud.');
    }
  };

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text;

    if (!text) return;

    console.log(`📩 Mensaje recibido de ${msg.from.first_name || 'usuario'}: ${text}`);

    if (text === '/start') {
      return bot.sendMessage(chatId, '¡Hola! Soy OpenGravity, tu agente autónomo con memoria local. ¿En qué puedo ayudarte?');
    }

    await processMessage(chatId, userId, text, msg.from.first_name);
  });

  bot.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const voice = msg.voice;

    try {
      bot.sendMessage(chatId, '🎤 Escuchando...');
      console.log(`📩 Nota de voz recibida de ${msg.from.first_name || 'usuario'}`);

      // Obtener enlace del archivo
      const fileLink = await bot.getFileLink(voice.file_id);
      
      // Transcribir con Whisper
      const transcription = await aiService.transcribeAudio(fileLink);
      console.log(`📝 Transcripción: ${transcription}`);

      await processMessage(chatId, userId, transcription, msg.from.first_name);
    } catch (error) {
      console.error('❌ Error procesando voz:', error.message);
      bot.sendMessage(chatId, 'Hubo un problema al procesar tu nota de voz.');
    }
  });

  console.log('✅ Bot de Telegram inicializado.');
  return bot;
};
