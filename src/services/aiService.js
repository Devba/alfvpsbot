import OpenAI from 'openai';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config/config.js';

import { toolService } from './toolService.js';
import { botInstance } from '../bot/telegramBot.js';
import * as db from '../database/database.js';

class AIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.openRouterKey,
      baseURL: config.openRouterUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://vps-opengravity.com',
        'X-Title': 'OpenGravity VPS',
      }
    });

    this.groqClient = new OpenAI({
      apiKey: config.aiApiKey,
      baseURL: config.aiBaseUrl
    });

    this.tools = [
      // ... (herramientas permanecen igual)
      {
        type: 'function',
        function: {
          name: 'ejecutar_comando',
          description: 'Ejecuta un comando de shell en el VPS en SEGUNDO PLANO. El resultado se envía directamente al usuario por Telegram más tarde. NO uses esta herramienta si necesitas el resultado para un paso posterior (como enviar un correo).',
          parameters: {
            type: 'object',
            properties: {
              comando: { type: 'string', description: 'El comando de consola a ejecutar.' }
            },
            required: ['comando']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'leer_archivo',
          description: 'Lee el contenido de un archivo en el VPS.',
          parameters: {
            type: 'object',
            properties: {
              ruta: { type: 'string', description: 'Ruta absoluta o relativa del archivo.' }
            },
            required: ['ruta']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'escribir_archivo',
          description: 'Escribe contenido en un archivo en el VPS.',
          parameters: {
            type: 'object',
            properties: {
              ruta: { type: 'string', description: 'Ruta donde guardar el archivo.' },
              contenido: { type: 'string', description: 'Contenido a escribir.' }
            },
            required: ['ruta', 'contenido']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'listar_archivos',
          description: 'Lista los archivos en un directorio del VPS.',
          parameters: {
            type: 'object',
            properties: {
              directorio: { type: 'string', description: 'Directorio a listar (opcional).' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'enviar_correo',
          description: 'Envía un correo electrónico usando la API de Gmail configurada en el VPS.',
          parameters: {
            type: 'object',
            properties: {
              destinatario: { type: 'string', description: 'Dirección de correo electrónico del destinatario.' },
              asunto: { type: 'string', description: 'Asunto del correo electrónico.' },
              cuerpo: { type: 'string', description: 'Cuerpo o contenido del correo electrónico (texto plano).' }
            },
            required: ['destinatario', 'asunto', 'cuerpo']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'ejecutar_script',
          description: 'Ejecuta un fragmento de código (JS/Python) de forma SINCRÓNICA (máx 30s). Úsala si necesitas obtener el resultado del script para procesarlo o enviarlo por correo.',
          parameters: {
            type: 'object',
            properties: {
              lenguaje: { type: 'string', enum: ['javascript', 'python'], description: 'El lenguaje de programación del script.' },
              codigo: { type: 'string', description: 'El código fuente a ejecutar.' }
            },
            required: ['lenguaje', 'codigo']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'navegar_web',
          description: 'Navega a una URL protegida por el sandbox del VPS para extraer texto o sacar capturas de pantalla.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'La URL completa a visitar (incluyendo http/https).' },
              accion: { type: 'string', enum: ['texto', 'captura'], description: 'La acción a realizar: "texto" para extraer el contenido legible o "captura" para un pantallazo.' }
            },
            required: ['url', 'accion']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'guardar_memoria',
          description: 'Guarda información importante a largo plazo (preferencias, identidad, configuraciones). NO la uses para charlas triviales.',
          parameters: {
            type: 'object',
            properties: {
              categoria: { type: 'string', description: 'Categoría (ej: identidad, preferencias, proyecto, error_solucionado).' },
              contenido: { type: 'string', description: 'El dato detallado a recordar.' },
              importancia: { type: 'integer', minimum: 1, maximum: 5, description: 'Prioridad del 1 al 5 (5 es crítica).' }
            },
            required: ['categoria', 'contenido']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'consultar_memoria',
          description: 'Busca información guardada en la memoria a largo plazo.',
          parameters: {
            type: 'object',
            properties: {
              busqueda: { type: 'string', description: 'Término o categoría a buscar.' }
            },
            required: ['busqueda']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'olvidar_memoria',
          description: 'Elimina una memoria específica por su ID si ya no es válida.',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: 'ID de la memoria a eliminar.' }
            },
            required: ['id']
          }
        }
      }
    ];
  }

  _getShortModelName(model) {
    if (!model) return 'AI';
    if (model.includes('gemma')) return 'Gem';
    if (model.includes('step')) return 'Step';
    if (model.includes('trinity')) return 'Trin';
    if (model.includes('grok')) return 'Grok';
    if (model.includes('minimax')) return 'Mini';
    if (model.includes('llama')) return 'Llama';
    return 'AI';
  }

  async getChatCompletion(userId, userMessage, history = []) {
    // 🧠 Determinación de Modelo
    let selectedModel = config.primaryModel;
    let finalMessage = userMessage;

    // Filtros de ruteo
    const grokPrefixRegex = /^grok\s*[:\s-]/i;
    const isForcedGrok = grokPrefixRegex.test(userMessage);
    const isLongGeneration = /escribe|genera|crea|manual|guía|script|código extenso|resumen detallado/i.test(userMessage);
    const isVisionTask = /captura|pantalla|mira|analiza imagen/i.test(userMessage);

    if (isForcedGrok) {
      selectedModel = config.backupModel;
      // Eliminar el prefijo (ej: "Grok:", "Grok :", "Grok ") de forma limpia
      finalMessage = userMessage.replace(grokPrefixRegex, '').trim();
      console.log(`🎯 [Router] Forzando Grok por prefijo flexible.`);
    } else if (isVisionTask) {
      selectedModel = config.primaryModel; // Grok-3 soporta visión (ahora Gemma 3 también, pero preferimos el primario)
    } else if (isLongGeneration) {
      selectedModel = config.specialistModel; // Minimax para salida larga
    }

    // 🧠 Inyección de Identidad (Skill 6)
    const identityMemories = db.getIdentityMemories();
    let identityPrompt = '';
    if (identityMemories.length > 0) {
      identityPrompt = '\n\n[CONTEXTO DE MEMORIA (Identidad/Preferencias)]:\n' +
        identityMemories.map(m => `- ${m.category}: ${m.content}`).join('\n');
    }

    const systemPromptWithMemories = config.systemPrompt + identityPrompt +
      '\n\nREGLA CRÍTICA DE MEMORIA: Si detectas información nueva que contradice o complementa tus conocimientos guardados, usa "consultar_memoria" antes de decidir si guardar o actualizar datos.';

    const client = this.client; // Usar siempre OpenRouter para modelos primario/especialista

    return this._executeWithFailover(client, selectedModel, [
      { role: 'system', content: systemPromptWithMemories },
      ...history,
      { role: 'user', content: finalMessage }
    ], userId);
  }

  async _executeWithFailover(client, model, messages, userId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 25000); // 25 segundos de timeout

    try {
      console.log(`🤖 [IA] Consultando ${model}...`);

      let response = await client.chat.completions.create({
        model: model,
        messages: messages,
        tools: this.tools,
        tool_choice: 'auto'
      }, { signal: controller.signal });

      clearTimeout(timeout);
      const content = await this._processResponse(client, model, messages, response, userId);
      return { content, model: this._getShortModelName(model) };

    } catch (error) {
      clearTimeout(timeout);

      const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
      const isFailoverError = isTimeout || error.status === 401 || error.status === 402 || error.status === 429 || error.status >= 500;

      if (isFailoverError && model !== config.backupModel) {
        const reason = isTimeout ? 'Timeout (25s)' : `Error ${error.status || 'desconocido'}`;
        console.warn(`⚠️ ${reason} en ${model}. Saltando a Backup: ${config.backupModel}`);

        if (botInstance && userId) {
          const msg = isTimeout
            ? '⚠️ *Nota:* El servidor gratuito está tardando demasiado. Saltando a Grok-4.1-Fast...'
            : `⚠️ *Nota:* El servidor principal tuvo un problema (${reason}). Usando respaldo...`;
          botInstance.sendMessage(userId, msg, { parse_mode: 'Markdown' }).catch(() => { });
        }

        try {
          const lastUserMessage = messages.findLast(m => m.role === 'user')?.content || '';
          const isTrivial = /^(hola|hey|buenas|saludos|hi|hello)$/i.test(lastUserMessage.trim());

          const backupMessages = [...messages];
          if (backupMessages[0].role === 'system') {
            backupMessages[0].content += '\n\nIMPORTANTE: Estás en modo de respaldo de ALTA PRIORIDAD. No escatimes en el uso de herramientas si es necesario.';
          }

          const backupOptions = {
            model: config.backupModel,
            messages: backupMessages
          };

          if (!isTrivial) {
            backupOptions.tools = this.tools;
            backupOptions.tool_choice = 'auto';
          }

          console.log(`🤖 [Backup] Consultando ${config.backupModel}...`);
          const backupResponse = await this.groqClient.chat.completions.create(backupOptions);
          const content = await this._processResponse(this.groqClient, config.backupModel, messages, backupResponse, userId);
          return { content, model: this._getShortModelName(config.backupModel) };

        } catch (backupError) {
          console.error(`❌ Error crítico en Backup (${config.backupModel}):`, backupError.message);
          return { content: 'Lo sentimos, tanto el modelo principal como el de respaldo han fallado. Por favor, intenta de nuevo más tarde.', model: 'Fail' };
        }
      }

      console.error(`❌ Error crítico en IA (${model}):`, error.message);
      return { content: 'Lo siento, hubo un error crítico en el sistema de IA.', model: 'Error' };
    }
  }

  async _processResponse(client, model, messages, response, userId) {
    const responseMessage = response.choices[0].message;

    if (responseMessage.tool_calls) {
      if (userId !== config.adminUserId) return '🚫 Sin permisos para herramientas.';

      messages.push(responseMessage);

      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        console.log(`🛠️ [${model}] Usando herramienta: ${functionName}`);

        try {
          const toolResponse = await toolService[functionName](functionArgs, { userId });
          messages.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: toolResponse || 'Éxito.'
          });
        } catch (e) {
          console.error(`❌ Error en herramienta ${functionName}:`, e.message);
          messages.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: `Error: ${e.message}`
          });
        }
      }

      const secondResponse = await client.chat.completions.create({
        model: model,
        messages: messages
      });

      return secondResponse.choices[0].message.content || 'La IA procesó las herramientas pero no devolvió una respuesta final.';
    }

    return responseMessage.content || 'La IA devolvió una respuesta vacía.';
  }
}

export const aiService = new AIService();
