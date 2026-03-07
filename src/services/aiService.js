import OpenAI from 'openai';
import axios from 'axios';
import FormData from 'form-data';
import { config } from '../config/config.js';

import { toolService } from './toolService.js';
import { botInstance } from '../bot/telegramBot.js';

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
      }
    ];
  }

  async getChatCompletion(userId, userMessage, history = []) {
    try {
      let messages = [
        { role: 'system', content: config.systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ];

      // Primera llamada a la IA (Primario)
      console.log(`🤖 [IA] Consultando proveedor principal (${config.primaryModel})...`);
      let response = await this.client.chat.completions.create({
        model: config.primaryModel,
        messages: messages,
        tools: this.tools,
        tool_choice: 'auto'
      });

      let responseMessage = response.choices[0].message;

      // Si la IA quiere usar herramientas
      if (responseMessage.tool_calls) {
        // Solo permitir herramientas al ADMIN
        if (userId !== config.adminUserId) {
          return '🚫 Lo siento, no tienes permisos para ejecutar acciones de sistema en este VPS.';
        }

        messages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          
          console.log(`🛠️ [TOOL] Usando herramienta: ${functionName}`);
          try {
            const toolResponse = await toolService[functionName](functionArgs, { userId });

            messages.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: toolResponse || 'Acción completada con éxito.',
            });
          } catch (toolError) {
            console.error(`❌ Error ejecutando herramienta ${functionName}:`, toolError.message);
            messages.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: `Error: ${toolError.message}`,
            });
          }
        }

        // Segunda llamada para obtener la respuesta final basada en el resultado de la herramienta
        const secondResponse = await this.client.chat.completions.create({
          model: config.primaryModel,
          messages: messages,
        });
        
        return secondResponse.choices[0].message.content;
      }

      return responseMessage.content;
    } catch (error) {
      console.warn(`⚠️ Error en proveedor principal (${config.primaryModel}):`, error.message);
      try {
        // Fallback a Groq (Secundario)
        console.warn(`⚠️ [IA] Proveedor principal falló. Cambiando a fallback: ${config.secondaryModel}`);
        if (botInstance && userId) {
          botInstance.sendMessage(userId, `⚠️ *Nota:* Usando modo de respaldo (${config.secondaryModel}). Las herramientas no estarán disponibles temporalmente.`, { parse_mode: 'Markdown' }).catch(() => {});
        }

        const groqClient = new OpenAI({
          apiKey: config.aiApiKey,
          baseURL: config.aiBaseUrl,
        });

        const fallbackMessages = [
            { role: 'system', content: config.systemPrompt },
            ...history,
            { role: 'user', content: userMessage },
        ];

        const response = await groqClient.chat.completions.create({
          model: config.secondaryModel,
          messages: fallbackMessages,
        });
        
        return response.choices[0].message.content;
      } catch (fallbackError) {
        console.error('❌ Error crítico en IA:', fallbackError.message);
        throw fallbackError;
      }
    }
  }
}

export const aiService = new AIService();
