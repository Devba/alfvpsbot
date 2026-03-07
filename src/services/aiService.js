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

  async getChatCompletion(userId, userMessage, history = []) {
    const useAnthropic = userMessage.toLowerCase().includes('usaanthrop');

    // 🧠 Inyección de Identidad (Skill 6)
    const identityMemories = db.getIdentityMemories();
    let identityPrompt = '';
    if (identityMemories.length > 0) {
      identityPrompt = '\n\n[CONTEXTO DE MEMORIA (Identidad/Preferencias)]:\n' + 
        identityMemories.map(m => `- ${m.category}: ${m.content}`).join('\n');
    }

    const systemPromptWithMemories = config.systemPrompt + identityPrompt + 
      '\n\nREGLA CRÍTICA DE MEMORIA: Si detectas información nueva que contradice o complementa tus conocimientos guardados, usa "consultar_memoria" antes de decidir si guardar o actualizar datos.';

    const isGroqDirect = config.aiBaseUrl.includes('groq.com');
    const client = useAnthropic ? this.client : (isGroqDirect ? new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl }) : this.client);
    const model = useAnthropic ? config.primaryModel : config.secondaryModel;

    console.log(`🤖 [IA] Consultando proveedor ${useAnthropic ? 'Principal' : 'Económico'} (${model})...`);

    try {
      // Prompt optimizado para Llama 3 si se usa Groq directo
      let finalSystemPrompt = systemPromptWithMemories;
      if (!useAnthropic && isGroqDirect) {
        finalSystemPrompt += '\n\nIMPORTANTE: Para usar tus herramientas, utiliza el formato JSON nativo de tool_calls. No inventes formatos de texto.';
      }

      let messages = [
        { role: 'system', content: finalSystemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ];

      // Primera llamada
      console.log(`📡 [IA] Enviando ${this.tools.length} herramientas a ${model}...`);
      let response = await client.chat.completions.create({
        model: model,
        messages: messages,
        tools: this.tools,
        tool_choice: 'auto'
      });

      let responseMessage = response.choices[0].message;

      // Bucle de herramientas (Solo si hay tool_calls y es el ADMIN)
      if (responseMessage.tool_calls) {
        if (userId !== config.adminUserId) {
          return '🚫 Lo siento, no tienes permisos para ejecutar acciones de sistema.';
        }

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
              content: toolResponse || 'Acción completada con éxito.',
            });
          } catch (toolError) {
            console.error(`❌ Error en herramienta ${functionName}:`, toolError.message);
            messages.push({
              tool_call_id: toolCall.id,
              role: 'tool',
              name: functionName,
              content: `Error: ${toolError.message}`,
            });
          }
        }

        // Segunda llamada con los resultados de las herramientas
        const secondResponse = await client.chat.completions.create({
          model: model,
          messages: messages,
        });
        
        return secondResponse.choices[0].message.content;
      }

      return responseMessage.content;
    } catch (error) {
      console.error(`❌ Error en ${model}:`, error.message);
      return 'Lo siento, hubo un error al procesar tu solicitud con el modelo seleccionado.';
    }
  }
}

export const aiService = new AIService();
