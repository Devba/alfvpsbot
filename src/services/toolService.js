import { exec } from 'child_process';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { enviarCorreo } from '../../gmail.js';

import { botInstance } from '../bot/telegramBot.js';
import * as db from '../database/database.js';
import { schedulerService } from './schedulerService.js';
import { cancelService } from './cancelService.js';

const execPromise = promisify(exec);

export const toolService = {
  async ejecutar_comando({ comando }, context) {
    const userId = context?.userId;
    try {
      console.log(`💻 Iniciando comando en background: ${comando}`);
      
      const child = exec(comando);
      const pid = child.pid;
      
      // Registrar el proceso para posible cancelación
      cancelService.registerCommand(userId, child);
      
      // Enviar resultado asíncronamente
      let output = '';
      child.stdout.on('data', (data) => { output += data; });
      child.stderr.on('data', (data) => { output += data; });

      const timeoutMs = 300000; // 5 minutos
      const timeoutId = setTimeout(() => {
        try {
          console.warn(`⏳ [TIMEOUT] Matando comando ${pid}: ${comando}`);
          process.kill(pid, 'SIGKILL');
          if (botInstance && userId) {
            botInstance.sendMessage(userId, `❌ [TIMEOUT] El comando (PID: ${pid}) excedió los 5 minutos y fue abortado.\n\nÚltima salida:\n${output.slice(-1500)}`);
          }
        } catch (e) {
          console.error(`Error matando proceso ${pid}:`, e);
        }
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        cancelService.unregisterOperation(userId);
        
        let finalMessage = `✅ [FIN] Comando finalizado (PID: ${pid}, código: ${code})\n\n`;
        if (code !== 0 && code !== null) {
          finalMessage = `⚠️ [FIN] Comando terminó con error (PID: ${pid}, código: ${code})\n\n`;
        }
        
        finalMessage += output ? output.slice(-2000) : 'Comando ejecutado sin salida.';
        
        if (botInstance && userId) {
          botInstance.sendMessage(userId, finalMessage).catch(console.error);
        }
      });

      return `🚀 Comando recibido y ejecutándose en segundo plano (PID: ${pid})... Se te notificará el resultado por Telegram cuando termine de forma silenciosa. Si es un proceso persistente, quedará en background.`;
    } catch (error) {
      cancelService.unregisterOperation(userId);
      return `❌ Error al iniciar comando: ${error.message}`;
    }
  },

  async leer_archivo({ ruta }) {
    try {
      const contenido = await fs.readFile(ruta, 'utf-8');
      return contenido;
    } catch (error) {
      return `❌ Error al leer archivo: ${error.message}`;
    }
  },

  async escribir_archivo({ ruta, contenido }) {
    try {
      // Asegurar que el directorio existe
      await fs.mkdir(path.dirname(ruta), { recursive: true });
      await fs.writeFile(ruta, contenido, 'utf-8');
      return `✅ Archivo escrito con éxito en ${ruta}`;
    } catch (error) {
      return `❌ Error al escribir archivo: ${error.message}`;
    }
  },

  async listar_archivos({ directorio }) {
    try {
      const archivos = await fs.readdir(directorio || '.');
      return archivos.join('\n');
    } catch (error) {
      return `❌ Error al listar archivos: ${error.message}`;
    }
  },

  async enviar_correo({ destinatario, asunto, cuerpo }) {
    try {
      console.log(`📧 Enviando correo a: ${destinatario}`);
      const res = await enviarCorreo(destinatario, asunto, cuerpo);
      return `✅ Correo enviado con éxito a ${destinatario}. Mensaje ID: ${res.id}`;
    } catch (error) {
      return `❌ Error al enviar el correo: ${error.message}`;
    }
  },

  async ejecutar_script({ lenguaje, codigo }, context) {
    const userId = context?.userId;
    const sandboxDir = path.resolve('sandbox');
    const fileName = `script_${Date.now()}.${lenguaje === 'javascript' ? 'js' : 'py'}`;
    const filePath = path.join(sandboxDir, fileName);
    const execCmd = lenguaje === 'javascript' ? `node ${filePath}` : `python3 ${filePath}`;

    try {
      // Crear carpeta si no existe (doble check)
      await fs.mkdir(sandboxDir, { recursive: true });
      
      // Escribir el código en el archivo temporal
      await fs.writeFile(filePath, codigo, 'utf-8');

      console.log(`🧪 [SANDBOX] Ejecutando script ${lenguaje} (${fileName})...`);
      
      // Ejecutar con child_process.exec para poder cancelar
      const child = exec(execCmd);
      const pid = child.pid;
      
      // Registrar para cancelación
      cancelService.registerCommand(userId, child);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });
      
      const timeoutMs = 30000; // 30 segundos
      const timeoutId = setTimeout(() => {
        try {
          console.warn(`⏳ [SANDBOX TIMEOUT] Matando script ${pid}`);
          process.kill(pid, 'SIGKILL');
        } catch (e) {
          console.error('Error matando script:', e.message);
        }
      }, timeoutMs);
      
      // Esperar a que termine
      await new Promise((resolve, reject) => {
        child.on('close', (code) => {
          clearTimeout(timeoutId);
          cancelService.unregisterOperation(userId);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Script terminó con código ${code}: ${stderr}`));
          }
        });
        child.on('error', (err) => {
          clearTimeout(timeoutId);
          cancelService.unregisterOperation(userId);
          reject(err);
        });
      });
      
      return `✅ [SANDBOX] Resultado:\n${stdout}${stderr ? '\nErrores:\n' + stderr : ''}`;
    } catch (error) {
      if (error.message.includes('SIGKILL') || error.message.includes('terminó con código')) {
        return `❌ [SANDBOX] Error: ${error.message}`;
      }
      return `❌ [SANDBOX] Error de ejecución:\n${error.message}`;
    } finally {
      // Limpieza: borrar el archivo temporal
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        console.error(`⚠️ [SANDBOX] No se pudo borrar el archivo temporal ${fileName}:`, cleanupError.message);
      }
    }
  },

  async navegar_web({ url, accion }, context) {
    let browser;
    const userId = context?.userId;
    try {
      console.log(`🌐 [WEB] Navegando a ${url} (Acción: ${accion})...`);
      
      // Verificar cancelación antes de iniciar
      if (cancelService.isCancelled(userId)) {
        return '❌ [WEB] Navegación cancelada por el usuario.';
      }
      
      browser = await puppeteer.launch({
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      // Registrar la navegación activa para este usuario
      cancelService.registerNavigation(userId, browser);

      const page = await browser.newPage();
      
      // Configurar User-Agent real
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      
      // Configurar Viewport estándar
      await page.setViewport({ width: 1920, height: 1080 });

      // Ocultar webdriver (parche básico)
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      // Timeout de 20 segundos para la carga
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

      if (accion === 'texto') {
        const text = await page.evaluate(() => {
          // Limpiar scripts y estilos
          const scripts = document.querySelectorAll('script, style');
          scripts.forEach(s => s.remove());
          return document.body.innerText;
        });
        return `✅ [WEB] Contenido extraído:\n${text.slice(0, 5000)}...`;
      } 
      
      if (accion === 'captura') {
        const screenshotPath = path.resolve('screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        
        if (botInstance && context?.userId) {
          await botInstance.sendPhoto(context.userId, screenshotPath, { caption: `📸 Captura de: ${url}` });
          return `✅ [WEB] Captura enviada correctamente por Telegram.`;
        }
        return `✅ [WEB] Captura guardada en el servidor (pero no se pudo enviar por Telegram).`;
      }

      return '❌ Acción no reconocida.';
    } catch (error) {
      const msg = error.name === 'TimeoutError' 
        ? '❌ [WEB] Error: La web tardó demasiado en cargar (límite 20s).' 
        : `❌ [WEB] Error al navegar: ${error.message}`;
      return msg;
    } finally {
      if (browser) await browser.close();
      // Desregistrar la operación y resetear estado
      cancelService.unregisterOperation(userId);
      cancelService.reset();
    }
  },

  // --- Herramientas de Memoria (Skill 6 - RAG-Lite) ---

  async guardar_memoria({ categoria, contenido, importancia = 3 }) {
    try {
      // Verificar duplicados (búsqueda parcial del contenido en la misma categoría)
      const contentSnippet = contenido.slice(0, 50);
      const existing = db.checkDuplicateMemory(categoria, contentSnippet);

      if (existing) {
        return `⚠️ Ya existe información similar en la categoría "${categoria}":\n"${existing.content}"\n\n¿Deseas que guarde esto de todas formas o prefieres borrar la anterior con olvidar_memoria(id: ${existing.id})?`;
      }

      const result = db.addMemory(categoria, contenido, importancia);
      return `✅ Memoria guardada con éxito en la categoría "${categoria}" (ID: \${result.lastInsertRowid}, Importancia: \${importancia}).`;
    } catch (error) {
      return `❌ Error al guardar memoria: \${error.message}`;
    }
  },

  async consultar_memoria({ busqueda }) {
    try {
      const results = db.searchMemories(busqueda);
      if (results.length === 0) {
        return `🔍 No se encontraron memorias que coincidan con "\${busqueda}".`;
      }

      let response = `🔍 Memorias encontradas para "\${busqueda}":\n\n`;
      results.forEach(m => {
        response += `[ID: \${m.id}] [\${m.category}] (Imp: \${m.importance}) \${m.content}\n---\n`;
      });
      return response;
    } catch (error) {
      return `❌ Error al consultar memoria: \${error.message}`;
    }
  },

  async olvidar_memoria({ id }) {
    try {
      const result = db.deleteMemory(id);
      if (result.changes > 0) {
        return `🗑️ Memoria con ID ${id} eliminada correctamente.`;
      } else {
        return `⚠️ No se encontró ninguna memoria con el ID ${id}.`;
      }
    } catch (error) {
      return `❌ Error al eliminar memoria: ${error.message}`;
    }
  },

  // --- Herramienta de Programación de Tareas ---

  async programar_tarea({ comando, minutos, hora, descripcion }, context) {
    try {
      console.debug(`🔧 [TOOL] programar_tarea llamado:`);
      console.debug(`   comando: ${comando}`);
      console.debug(`   minutos: ${minutos}`);
      console.debug(`   hora: ${hora}`);
      console.debug(`   descripcion: ${descripcion}`);
      console.debug(`   context.userId: ${context?.userId}`);
      
      let result;
      if (minutos) {
        // Programar en X minutos
        if (typeof minutos !== 'number' || minutos <= 0) {
          return '❌ El parámetro "minutos" debe ser un número positivo.';
        }
        result = schedulerService.scheduleInMinutes(
          context.userId, 
          minutos, 
          comando, 
          descripcion || `Comando: ${comando}`
        );
        console.debug(`✅ [TOOL] Tarea programada, resultado:`, result);
        return `✅ Tarea programada para dentro de ${minutos} minuto(s).\nID: ${result.jobId}\nEjecución: ${result.executionTime.toLocaleString()}`;
      } 
      else if (hora) {
        // Programar a hora específica
        result = schedulerService.scheduleAtTime(
          context.userId, 
          hora, 
          comando, 
          descripcion || `Comando: ${comando}`
        );
        console.debug(`✅ [TOOL] Tarea programada (hora), resultado:`, result);
        return `✅ Tarea programada para ${hora}.\nID: ${result.jobId}\nExpresión cron: ${result.cronExpression}`;
      } 
      else {
        return '❌ Debes especificar "minutos" o "hora". Ejemplos:\n- minutos: 5\n- hora: "14:30" o "14:30 15/03/2026"';
      }
    } catch (error) {
      console.error(`❌ [TOOL] Error al programar tarea:`, error.message);
      return `❌ Error al programar tarea: ${error.message}`;
    }
  },

  async listar_tareas_programadas(_, context) {
    try {
      console.debug(`🔧 [TOOL] listar_tareas_programadas llamado para userId: ${context?.userId}`);
      const tasks = schedulerService.getActiveTasksForChat(context.userId);
      console.debug(`   Tareas encontradas: ${tasks.length}`);
      
      if (tasks.length === 0) {
        return '📋 No hay tareas programadas pendientes.';
      }
      
      let response = `📋 Tareas programadas (${tasks.length}):\n\n`;
      tasks.forEach((task, index) => {
        const fecha = new Date(task.execution_time).toLocaleString();
        response += `${index + 1}. ID: ${task.job_id}\n`;
        response += `   Comando: ${task.command}\n`;
        response += `   Descripción: ${task.description || 'Sin descripción'}\n`;
        response += `   Ejecución: ${fecha}\n`;
        response += `   Tipo: ${task.type}\n\n`;
      });
      return response;
    } catch (error) {
      console.error(`❌ [TOOL] Error al listar tareas:`, error.message);
      return `❌ Error al listar tareas: ${error.message}`;
    }
  },

  async cancelar_tarea({ job_id }, context) {
    try {
      console.debug(`🔧 [TOOL] cancelar_tarea llamado para job_id: ${job_id}`);
      const success = schedulerService.cancelJob(job_id);
      
      if (success) {
        console.debug(`✅ [TOOL] Tarea ${job_id} cancelada correctamente.`);
        return `✅ Tarea ${job_id} cancelada correctamente.`;
      } else {
        console.warn(`⚠️ [TOOL] No se encontró la tarea con ID ${job_id}.`);
        return `⚠️ No se encontró la tarea con ID ${job_id}.`;
      }
    } catch (error) {
      console.error(`❌ [TOOL] Error al cancelar tarea:`, error.message);
      return `❌ Error al cancelar tarea: ${error.message}`;
    }
  },

  async cancelar_operacion(_, context) {
    try {
      console.log(`🛑 [CANCEL] Operación cancelada por usuario ${context?.userId}`);
      cancelService.requestCancel();
      
      // Esperar un momento para que la cancelación se procese
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return '✅ Operación cancelada. Si hay una navegación en curso, se ha detenido.';
    } catch (error) {
      console.error(`❌ [CANCEL] Error al cancelar:`, error.message);
      return `❌ Error al cancelar: ${error.message}`;
    }
  },

  // --- Herramienta de Programación de Correos ---

  async programar_envio_correo({ destinatario, asunto, cuerpo, minutos, hora, descripcion }, context) {
    try {
      console.debug(`🔧 [TOOL] programar_envio_correo llamado:`);
      console.debug(`   destinatario: ${destinatario}`);
      console.debug(`   asunto: ${asunto}`);
      console.debug(`   minutos: ${minutos}`);
      console.debug(`   hora: ${hora}`);
      console.debug(`   context.userId: ${context?.userId}`);
      
      if (!destinatario || !asunto || !cuerpo) {
        return '❌ Debes proporcionar destinatario, asunto y cuerpo del correo.';
      }
      
      let result;
      if (minutos) {
        if (typeof minutos !== 'number' || minutos <= 0) {
          return '❌ El parámetro "minutos" debe ser un número positivo.';
        }
        result = schedulerService.scheduleEmail(
          context.userId,
          minutos,
          destinatario,
          asunto,
          cuerpo,
          descripcion || `Correo a ${destinatario}`
        );
        return `✅ Correo programado para enviar en ${minutos} minuto(s) a ${destinatario}.\nID: ${result.jobId}\nAsunto: ${asunto}`;
      } 
      else if (hora) {
        result = schedulerService.scheduleEmailAtTime(
          context.userId,
          hora,
          destinatario,
          asunto,
          cuerpo,
          descripcion || `Correo a ${destinatario}`
        );
        return `✅ Correo programado para enviar a ${hora} a ${destinatario}.\nID: ${result.jobId}\nAsunto: ${asunto}`;
      } 
      else {
        return '❌ Debes especificar "minutos" o "hora". Ejemplos:\n- minutos: 5\n- hora: "14:30" o "14:30 15/03/2026"';
      }
    } catch (error) {
      console.error(`❌ [TOOL] Error al programar envío de correo:`, error.message);
      return `❌ Error al programar envío de correo: ${error.message}`;
    }
  }
};
