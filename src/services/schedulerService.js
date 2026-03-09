import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as db from '../database/database.js';
import { botInstance } from '../bot/telegramBot.js';

const execPromise = promisify(exec);

class SchedulerService {
  constructor() {
    this.scheduledJobs = new Map();
    console.log('📦 [SCHEDULER] Instancia de SchedulerService creada');
  }

  // Programar comando para ejecutar en X minutos
  scheduleInMinutes(chatId, minutes, command, description = '') {
    const executionTime = new Date(Date.now() + minutes * 60 * 1000);
    const jobId = `job_${Date.now()}_${chatId}`;
    
    console.log(`📅 [SCHEDULER] Nueva tarea programada:`);
    console.log(`   ID: ${jobId}`);
    console.log(`   Chat: ${chatId}`);
    console.log(`   Descripción: ${description}`);
    console.log(`   Comando: ${command}`);
    console.log(`   Ejecución: ${executionTime.toLocaleString()} (en ${minutes} min)`);
    
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
    
    console.log(`     ✅ Tarea guardada en BD y programada con timeout ID: ${timeoutId}`);
    
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
    
    console.log(`📅 [SCHEDULER] Nueva tarea programada (hora exacta):`);
    console.log(`   ID: ${jobId}`);
    console.log(`   Chat: ${chatId}`);
    console.log(`   Descripción: ${description}`);
    console.log(`   Comando: ${command}`);
    console.log(`   Ejecución: ${executionTime.toLocaleString()} (en ${Math.round(delayMs/1000)} segundos)`);
    
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
    
    console.log(`     ✅ Tarea guardada en BD y programada con timeout ID: ${timeoutId}`);
    
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
    console.log(`📊 [SCHEDULER] getActiveTasksForChat(${chatId}): ${tasks.length} tareas`);
    return tasks;
  }

  // Cargar tareas pendientes desde la base de datos al iniciar
  loadPendingTasks() {
    const tasks = db.getAllActiveTasks();
    console.log(`📋 [SCHEDULER] Cargando ${tasks.length} tareas pendientes desde la base de datos...`);
    
    tasks.forEach(task => {
      try {
        console.log(`  📌 Tarea ${task.job_id}: ${task.description}`);
        console.log(`     Comando: ${task.command}`);
        console.log(`     Ejecución: ${task.execution_time}`);
        
        const executionTime = new Date(task.execution_time);
        const now = new Date();
        const delayMs = executionTime - now;
        
        console.log(`     Delay: ${delayMs}ms (${Math.round(delayMs/1000)} segundos)`);
        
        if (delayMs <= 0) {
          // La tarea ya pasó, marcarla como ejecutada
          console.log(`     ⚠️ Tarea ya vencida, marcando como ejecutada`);
          db.markTaskAsExecuted(task.job_id);
          return;
        }
        
        // Todas las tareas usan setTimeout (tanto delay como cron)
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
            
            console.log(`     Comando limpio: ${cleanCommand}`);
            
            // Escapar comillas simples para bash -c
            const escapedCommand = cleanCommand.replace(/'/g, "'\\''");
            // Ejecutar con bash para soporte completo de características
            const { stdout, stderr } = await execPromise(`bash -c '${escapedCommand}'`, { timeout: 30000 });
            const result = stdout + (stderr ? '\n' + stderr : '');
            
            console.log(`     Resultado: ${result.slice(0, 200)}`);
            
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
        console.log(`     ✅ Tarea programada con timeout ID: ${timeoutId}`);
        
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error al cargar tarea ${task.job_id}:`, error.message);
      }
    });
  }
}

export const schedulerService = new SchedulerService();
