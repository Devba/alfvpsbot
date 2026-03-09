import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as db from '../database/database.js';
import { botInstance } from '../bot/telegramBot.js';

const execPromise = promisify(exec);

class SchedulerService {
  constructor() {
    this.scheduledJobs = new Map();
  }

  // Programar comando para ejecutar en X minutos
  scheduleInMinutes(chatId, minutes, command, description = '') {
    const executionTime = new Date(Date.now() + minutes * 60 * 1000);
    const jobId = `job_${Date.now()}_${chatId}`;
    
    const timeoutId = setTimeout(async () => {
      console.log(`⏰ [SCHEDULER] Ejecutando tarea programada: ${description}`);
      try {
        const { stdout, stderr } = await execPromise(command, { timeout: 30000 });
        const result = stdout + (stderr ? '\n' + stderr : '');
        
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
    
    const timeoutId = setTimeout(async () => {
      console.log(`⏰ [SCHEDULER] Ejecutando tarea programada: ${description}`);
      try {
        const { stdout, stderr } = await execPromise(command, { timeout: 30000 });
        const result = stdout + (stderr ? '\n' + stderr : '');
        
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
    return db.getAllActiveTasks(chatId);
  }

  // Cargar tareas pendientes desde la base de datos al iniciar
  loadPendingTasks() {
    const tasks = db.getAllActiveTasks();
    console.log(`📋 [SCHEDULER] Cargando ${tasks.length} tareas pendientes desde la base de datos...`);
    
    tasks.forEach(task => {
      try {
        const executionTime = new Date(task.execution_time);
        const now = new Date();
        const delayMs = executionTime - now;
        
        if (delayMs <= 0) {
          // La tarea ya pasó, marcarla como ejecutada
          db.markTaskAsExecuted(task.job_id);
          return;
        }
        
        // Todas las tareas usan setTimeout (tanto delay como cron)
        const timeoutId = setTimeout(async () => {
          console.log(`⏰ [SCHEDULER] Ejecutando tarea programada: ${task.description}`);
          try {
            const { stdout, stderr } = await execPromise(task.command, { timeout: 30000 });
            const result = stdout + (stderr ? '\n' + stderr : '');
            
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
        
      } catch (error) {
        console.error(`❌ [SCHEDULER] Error al cargar tarea ${task.job_id}:`, error.message);
      }
    });
  }
}

export const schedulerService = new SchedulerService();
