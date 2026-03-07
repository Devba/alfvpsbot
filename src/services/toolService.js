import { exec } from 'child_process';
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { enviarCorreo } from '../../gmail.js';

import { botInstance } from '../bot/telegramBot.js';

const execPromise = promisify(exec);

export const toolService = {
  async ejecutar_comando({ comando }, context) {
    try {
      console.log(`💻 Iniciando comando en background: ${comando}`);
      
      const child = exec(comando);
      const pid = child.pid;
      
      // Enviar resultado asíncronamente
      let output = '';
      child.stdout.on('data', (data) => { output += data; });
      child.stderr.on('data', (data) => { output += data; });

      const timeoutMs = 300000; // 5 minutos
      const timeoutId = setTimeout(() => {
        try {
          console.warn(`⏳ [TIMEOUT] Matando comando ${pid}: ${comando}`);
          process.kill(pid, 'SIGKILL');
          if (botInstance && context?.userId) {
            botInstance.sendMessage(context.userId, `❌ [TIMEOUT] El comando (PID: ${pid}) excedió los 5 minutos y fue abortado.\n\nÚltima salida:\n${output.slice(-1500)}`);
          }
        } catch (e) {
          console.error(`Error matando proceso ${pid}:`, e);
        }
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        let finalMessage = `✅ [FIN] Comando finalizado (PID: ${pid}, código: ${code})\n\n`;
        if (code !== 0 && code !== null) {
          finalMessage = `⚠️ [FIN] Comando terminó con error (PID: ${pid}, código: ${code})\n\n`;
        }
        
        finalMessage += output ? output.slice(-2000) : 'Comando ejecutado sin salida.';
        
        if (botInstance && context?.userId) {
          botInstance.sendMessage(context.userId, finalMessage).catch(console.error);
        }
      });

      return `🚀 Comando recibido y ejecutándose en segundo plano (PID: ${pid})... Se te notificará el resultado por Telegram cuando termine de forma silenciosa. Si es un proceso persistente, quedará en background.`;
    } catch (error) {
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

  async ejecutar_script({ lenguaje, codigo }) {
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

      // Ejecutar con timeout de 30 segundos
      const { stdout, stderr } = await execPromise(execCmd, { timeout: 30000 });
      
      return `✅ [SANDBOX] Resultado:\n${stdout}${stderr ? '\nErrores:\n' + stderr : ''}`;
    } catch (error) {
      if (error.killed) {
        return `❌ [SANDBOX] Error: La ejecución excedió el límite de 30 segundos.`;
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
    try {
      console.log(`🌐 [WEB] Navegando a ${url} (Acción: ${accion})...`);
      browser = await puppeteer.launch({
        args: [
          '--no-sandbox', 
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled'
        ]
      });

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
        return `🗑️ Memoria con ID \${id} eliminada correctamente.`;
      } else {
        return `⚠️ No se encontró ninguna memoria con el ID \${id}.`;
      }
    } catch (error) {
      return `❌ Error al eliminar memoria: \${error.message}`;
    }
  }
};
