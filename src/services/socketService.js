import { Server } from 'socket.io';
import { config } from '../config/config.js';
import { toolService } from './toolService.js';
import fs from 'fs/promises';
import path from 'path';

let io;

export const initSocket = () => {
  io = new Server(config.socketPort, {
    cors: {
      origin: "*", // Permitir cualquier origen por IP dinámica
      methods: ["GET", "POST"]
    }
  });

  // Middleware de Autenticación
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === config.socketAuthToken) {
      console.log(`🔑 [SOCKET] Autenticación exitosa para socket: ${socket.id}`);
      next();
    } else {
      console.error(`❌ [SOCKET] Intento de conexión no autorizado de: ${socket.id}`);
      next(new Error("⚠️ No autorizado: Token inválido"));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 [SOCKET] Portátil conectado: ${socket.id}`);

    // Manejo de comandos remotos
    socket.on('comando', async (args, callback) => {
      console.log(`💻 [SOCKET] Comando remoto recibido: ${args.comando}`);
      const resultado = await toolService.ejecutar_comando({ comando: args.comando });
      
      if (callback) {
        callback(resultado);
      } else {
        socket.emit('respuesta_comando', resultado);
      }
    });

    socket.on('enviar-archivo', async (data) => {
      try {
        const { nombre, contenido, ruta } = data;
        console.log(`📥 [SOCKET] Recibiendo archivo: ${nombre} en ruta: ${ruta}`);

        // Asegurarse de que el directorio exista
        const directorio = path.dirname(ruta);
        await fs.mkdir(directorio, { recursive: true });
        
        // Escribir el archivo
        await fs.writeFile(ruta, contenido);
        
        console.log(`✅ [SOCKET] Archivo guardado correctamente en: ${ruta}`);
        
        // Emitir confirmación al cliente
        socket.emit('archivo-recibido', { success: true, nombre, ruta, mensaje: 'Archivo guardado correctamente' });
      } catch (error) {
        console.error(`❌ [SOCKET] Error al procesar 'enviar-archivo':`, error);
        socket.emit('archivo-recibido', { success: false, error: error.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`📴 [SOCKET] Portátil desconectado: ${socket.id}`);
    });
  });

  console.log(`🚀 [SOCKET] Servidor Socket.io escuchando en el puerto ${config.socketPort}`);
};

// Función global para enviar notificaciones proactivas
export const enviarNotificacionAlPortatil = (mensaje) => {
  if (io) {
    console.log(`📢 [SOCKET] Enviando notificación proactiva: ${mensaje}`);
    io.emit('notificacion', {
      mensaje,
      timestamp: new Date().toISOString()
    });
  } else {
    console.warn('⚠️ [SOCKET] El servidor de sockets no está inicializado.');
  }
};
