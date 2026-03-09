import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as db from '../database/database.js';
import { botInstance } from '../bot/telegramBot.js';
import { enviarCorreo } from '../../gmail.js';

const execPromise = promisify(exec);

class SchedulerService {
  constructor() {
    this.scheduledJobs = new Map();
    console.debug('📦 [SCHEDULER] Instancia de SchedulerService creada');
  }

  // Programar comando para ejecutar en X minutos
  scheduleInMinutes(chatId, minutes, command, description = '') {
    const executionTime = new Date(Date.now() + minutes * 60 * 1000);
    const jobId = `job_${Date.now()}_${chatId}`;
    
    console.debug(`📅 [SCHEDULER] Nueva tarea programada:`);
    console.debug(`   ID: ${jobId}`);
    console.debug(`   Chat: ${chatId}`);
    console.debug(`   Descripción: ${description}`);
    console.debug(`   Comando: ${command}`);
    console.debug(`   Ejecución: ${executionTime.toLocaleString()} (en ${minutes} min)`);
    
    const timeoutId = setTimeout(async () => {
      console.log(`⏰ [SCHEDULER] Ejecutando tarea programada: ${description}`);
      try {
        // Limpiar entidades HTML comunes que la IA podría enviar por error
        let cleanCommand = command
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        
        console.debug(`     Comando limpio: ${cleanCommand}`);
        
        // Escapar comillas simples para bash -c
        const escapedCommand = cleanCommand.replace(/'/g, "'\\''");
        // Ejecutar con bash para soporte completo de características
        const { stdout, stderr } = await execPromise(`bash -c '${escapedCommand}'`, { timeout: 30000 });
        const result = stdout + (stderr ? '\n' + stderr : '');
        
        console.debug(`     Resultado: ${result.slice(0, 200)}`);
        
        // Marcar como ejecutada en BD
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        // Notificar por Telegram
        if (botInstance) {
          botInstance.sendMessage(chatId, `✅ Tarea completada:\n${description}\n\nResultado:\n${result.slice(0, 2000)}`);
        }
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error ejecutando comando:`, error.message);
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        if (botInstance) {
          botInstance.sendMessage(chatId, `❌ Error al ejecutar la tarea:\n${error.message}`);
        }
      }
    }, minutes * 60 * 1000);

    this.scheduledJobs.set(jobId, timeoutId);
    
    // Guardar en base de datos para persistencia
    db.saveScheduledTask(jobId, chatId, command, executionTime.toISOString(), description, 'delay');
    
    console.debug(`     ✅ Tarea guardada en BD y programada con timeout ID: ${timeoutId}`);
    
    return { jobId, executionTime };
  }

  // Programar comando a una hora específica (formato: "HH:MM" o "HH:MM DD/MM/YYYY")
  scheduleAtTime(chatId, timeString, command, description = '') {
    const executionTime = this.parseToDate(timeString);
    const jobId = `job_${Date.now()}_${chatId}`;
    const delayMs = executionTime - new Date();
    
    if (delayMs <= 0) {
      throw new Error('La hora especificada ya ha pasado.');
    }
    
    console.debug(`📅 [SCHEDULER] Nueva tarea programada (hora exacta):`);
    console.debug(`   ID: ${jobId}`);
    console.debug(`   Chat: ${chatId}`);
    console.debug(`   Descripción: ${description}`);
    console.debug(`   Comando: ${command}`);
    console.debug(`   Ejecución: ${executionTime.toLocaleString()} (en ${Math.round(delayMs/1000)} segundos)`);
    
    const timeoutId = setTimeout(async () => {
      console.log(`⏰ [SCHEDULER] Ejecutando tarea programada: ${description}`);
      try {
        // Limpiar entidades HTML comunes que la IA podría enviar por error
        let cleanCommand = command
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        
        console.log(`     Comando limpio: ${cleanCommand}`);
        
        // Escapar comillas simples para bash -c
        const escapedCommand = cleanCommand.replace(/'/g, "'\\''");
        // Ejecutar con bash para soporte completo de características
        const { stdout, stderr } = await execPromise(`bash -c '${escapedCommand}'`, { timeout: 30000 });
        const result = stdout + (stderr ? '\n' + stderr : '');
        
        console.log(`     Resultado: ${result.slice(0, 200)}`);
        
        // Marcar como ejecutada en BD
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        if (botInstance) {
          botInstance.sendMessage(chatId, `✅ Tarea completada:\n${description}\n\nResultado:\n${result.slice(0, 2000)}`);
        }
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error ejecutando comando:`, error.message);
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        if (botInstance) {
          botInstance.sendMessage(chatId, `❌ Error al ejecutar la tarea:\n${error.message}`);
        }
      }
    }, delayMs);

    this.scheduledJobs.set(jobId, timeoutId);
    db.saveScheduledTask(jobId, chatId, command, executionTime.toISOString(), description, 'cron');
    
    console.debug(`     ✅ Tarea guardada en BD y programada con timeout ID: ${timeoutId}`);
    
    return { jobId, executionTime };
  }

  // Programar envío de correo electrónico
  scheduleEmail(chatId, minutes, to, subject, body, description = '') {
    const executionTime = new Date(Date.now() + minutes * 60 * 1000);
    const jobId = `email_${Date.now()}_${chatId}`;
    
    console.debug(`📧 [SCHEDULER] Nueva tarea de correo programada:`);
    console.debug(`   ID: ${jobId}`);
    console.debug(`   Para: ${to}`);
    console.debug(`   Asunto: ${subject}`);
    console.debug(`   Ejecución: ${executionTime.toLocaleString()} (en ${minutes} min)`);
    
    const timeoutId = setTimeout(async () => {
      console.log(`⏰ [SCHEDULER] Ejecutando envío de correo: ${description || subject}`);
      try {
        const result = await enviarCorreo(to, subject, body);
        
        console.debug(`     Correo enviado, ID: ${result.id}`);
        
        // Marcar como ejecutada en BD (usamos tipo 'email')
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        // Notificar por Telegram
        if (botInstance) {
          botInstance.sendMessage(chatId, `✅ Correo programado enviado:\nPara: ${to}\nAsunto: ${subject}\n\nID del mensaje: ${result.id}`);
        }
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error enviando correo:`, error.message);
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        if (botInstance) {
          botInstance.sendMessage(chatId, `❌ Error al enviar el correo programado:\n${error.message}`);
        }
      }
    }, minutes * 60 * 1000);

    this.scheduledJobs.set(jobId, timeoutId);
    
    // Guardar en base de datos para persistencia (tipo 'email')
    db.saveScheduledTask(jobId, chatId, `EMAIL:${to}|${subject}|${body}`, executionTime.toISOString(), description || subject, 'email');
    
    console.debug(`     ✅ Tarea de correo guardada en BD y programada`);
    
    return { jobId, executionTime };
  }

  // Programar envío de correo a una hora específica
  scheduleEmailAtTime(chatId, timeString, to, subject, body, description = '') {
    const executionTime = this.parseToDate(timeString);
    const jobId = `email_${Date.now()}_${chatId}`;
    const delayMs = executionTime - new Date();
    
    if (delayMs <= 0) {
      throw new Error('La hora especificada ya ha pasado.');
    }
    
    console.debug(`📧 [SCHEDULER] Nueva tarea de correo programada (hora exacta):`);
    console.debug(`   ID: ${jobId}`);
    console.debug(`   Para: ${to}`);
    console.debug(`   Asunto: ${subject}`);
    console.debug(`   Ejecución: ${executionTime.toLocaleString()} (en ${Math.round(delayMs/1000)} segundos)`);
    
    const timeoutId = setTimeout(async () => {
      console.log(`⏰ [SCHEDULER] Ejecutando envío de correo: ${description || subject}`);
      try {
        const result = await enviarCorreo(to, subject, body);
        
        console.debug(`     Correo enviado, ID: ${result.id}`);
        
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        if (botInstance) {
          botInstance.sendMessage(chatId, `✅ Correo programado enviado:\nPara: ${to}\nAsunto: ${subject}\n\nID del mensaje: ${result.id}`);
        }
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error enviando correo:`, error.message);
        db.markTaskAsExecuted(jobId);
        this.scheduledJobs.delete(jobId);
        
        if (botInstance) {
          botInstance.sendMessage(chatId, `❌ Error al enviar el correo programado:\n${error.message}`);
        }
      }
    }, delayMs);

    this.scheduledJobs.set(jobId, timeoutId);
    db.saveScheduledTask(jobId, chatId, `EMAIL:${to}|${subject}|${body}`, executionTime.toISOString(), description || subject, 'email');
    
    console.debug(`     ✅ Tarea de correo guardada en BD y programada`);
    
    return { jobId, executionTime };
  }

  parseToDate(timeString) {
    // Formatos soportados:
    // "HH:MM" -> hoy a esa hora (o mañana si ya pasó)
    // "HH:MM DD/MM/YYYY" -> fecha y hora específica
    
    const parts = timeString.trim().split(' ');
    let date = new Date();
    const now = new Date();
    
    if (parts.length === 1) {
      // Solo hora: "14:30"
      const [hour, minute] = parts[0].split(':').map(Number);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error('Formato de hora inválido. Usa HH:MM (ej: 14:30)');
      }
      
      date.setHours(hour, minute, 0, 0);
      
      // Si la hora ya pasó hoy, programar para mañana
      if (date <= now) {
        date.setDate(date.getDate() + 1);
      }
    } else if (parts.length === 2) {
      // Hora y fecha: "14:30 15/03/2026"
      const [hour, minute] = parts[0].split(':').map(Number);
      const [day, month, year] = parts[1].split('/').map(Number);
      
      if (isNaN(hour) || isNaN(minute) || isNaN(day) || isNaN(month) || isNaN(year)) {
        throw new Error('Formato de fecha/hora inválido. Usa HH:MM DD/MM/YYYY');
      }
      
      date = new Date(year, month - 1, day, hour, minute, 0, 0);
    } else {
      throw new Error('Formato no reconocido. Usa "HH:MM" o "HH:MM DD/MM/YYYY"');
    }
    
    return date;
  }

  cancelJob(jobId) {
    const job = this.scheduledJobs.get(jobId);
    if (job) {
      if (job instanceof cron.CronJob) {
        job.stop();
      } else {
        clearTimeout(job);
      }
      this.scheduledJobs.delete(jobId);
      db.deleteScheduledTask(jobId);
      return true;
    }
    return false;
  }

  // Obtener todas las tareas activas de un chat
  getActiveTasksForChat(chatId) {
    const tasks = db.getAllActiveTasks(chatId);
    console.debug(`📊 [SCHEDULER] getActiveTasksForChat(${chatId}): ${tasks.length} tareas`);
    return tasks;
  }

  // Cargar tareas pendientes desde la base de datos al iniciar
  loadPendingTasks() {
    const tasks = db.getAllActiveTasks();
    console.debug(`📋 [SCHEDULER] Cargando ${tasks.length} tareas pendientes desde la base de datos...`);
    
    tasks.forEach(task => {
      try {
        console.debug(`  📌 Tarea ${task.job_id}: ${task.description}`);
        console.debug(`     Comando: ${task.command}`);
        console.debug(`     Ejecución: ${task.execution_time}`);
        
        const executionTime = new Date(task.execution_time);
        const now = new Date();
        const delayMs = executionTime - now;
        
        console.debug(`     Delay: ${delayMs}ms (${Math.round(delayMs/1000)} segundos)`);
        
        if (delayMs <= 0) {
          // La tarea ya pasó, marcarla como ejecutada
          console.log(`     ⚠️ Tarea ya vencida, marcando como ejecutada`);
          db.markTaskAsExecuted(task.job_id);
          return;
        }
        
        // Manejar tareas según su tipo
        if (task.type === 'email') {
          // Formato: EMAIL:to|subject|body
          const parts = task.command.substring(6).split('|'); // quitar 'EMAIL:'
          if (parts.length >= 3) {
            const [to, subject, body] = parts;
            
            const timeoutId = setTimeout(async () => {
              console.log(`⏰ [SCHEDULER] Ejecutando envío de correo: ${task.description}`);
              try {
                const result = await enviarCorreo(to, subject, body);
                
                console.debug(`     Correo enviado, ID: ${result.id}`);
                
                db.markTaskAsExecuted(task.job_id);
                this.scheduledJobs.delete(task.job_id);
                
                if (botInstance) {
                  botInstance.sendMessage(task.chat_id, `✅ Correo enviado:\nPara: ${to}\nAsunto: ${subject}\n\nID: ${result.id}`);
                }
              } catch (error) {
                console.error(`❌ [SCHEDULER] Error enviando correo:`, error.message);
                db.markTaskAsExecuted(task.job_id);
                this.scheduledJobs.delete(task.job_id);
                
                if (botInstance) {
                  botInstance.sendMessage(task.chat_id, `❌ Error al enviar correo:\n${error.message}`);
                }
              }
            }, delayMs);
            
            this.scheduledJobs.set(task.job_id, timeoutId);
            console.debug(`     ✅ Tarea de correo programada`);
          } else {
            console.error(`❌ [SCHEDULER] Formato de correo inválido en tarea ${task.job_id}`);
            db.markTaskAsExecuted(task.job_id);
          }
        } else {
          // Tareas de comando (delay o cron)
          const timeoutId = setTimeout(async () => {
            console.log(`⏰ [SCHEDULER] Ejecutando tarea programada: ${task.description}`);
            try {
              // Limpiar entidades HTML comunes que la IA podría enviar por error
              let cleanCommand = task.command
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
              
              console.debug(`     Comando limpio: ${cleanCommand}`);
              
              // Escapar comillas simples para bash -c
              const escapedCommand = cleanCommand.replace(/'/g, "'\\''");
              // Ejecutar con bash para soporte completo de características
              const { stdout, stderr } = await execPromise(`bash -c '${escapedCommand}'`, { timeout: 30000 });
              const result = stdout + (stderr ? '\n' + stderr : '');
              
              console.debug(`     Resultado: ${result.slice(0, 200)}`);
              
              db.markTaskAsExecuted(task.job_id);
              this.scheduledJobs.delete(task.job_id);
              
              if (botInstance) {
                botInstance.sendMessage(task.chat_id, `✅ Tarea completada:\n${task.description}\n\nResultado:\n${result.slice(0, 2000)}`);
              }
            } catch (error) {
              console.error(`❌ [SCHEDULER] Error ejecutando comando:`, error.message);
              db.markTaskAsExecuted(task.job_id);
              this.scheduledJobs.delete(task.job_id);
              
              if (botInstance) {
                botInstance.sendMessage(task.chat_id, `❌ Error al ejecutar la tarea:\n${error.message}`);
              }
            }
          }, delayMs);
          
          this.scheduledJobs.set(task.job_id, timeoutId);
        }
        
        this.scheduledJobs.set(task.job_id, timeoutId);
        console.log(`     ✅ Tarea programada con timeout ID: ${timeoutId}`);
        
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error al cargar tarea ${task.job_id}:`, error.message);
      }
    });
  }
}

export const schedulerService = new SchedulerService();
