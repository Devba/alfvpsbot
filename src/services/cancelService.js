// Servicio de cancelación global para operaciones en curso
class CancelService {
  constructor() {
    this.cancelRequested = false;
    this.activeOperations = new Map(); // userId -> { type, resource }
  }

  // Registrar una operación activa
  registerOperation(userId, type, resource) {
    this.activeOperations.set(userId, { type, resource });
    console.log(`📝 [CANCEL] Operación registrada: ${type} para usuario ${userId}`);
  }

  // Desregistrar una operación
  unregisterOperation(userId) {
    this.activeOperations.delete(userId);
    console.log(`🗑️ [CANCEL] Operación desregistrada para usuario ${userId}`);
  }

  // Solicitar cancelación para un usuario específico
  requestCancel(userId = null) {
    this.cancelRequested = true;
    console.log('🛑 [CANCEL] Cancelación solicitada');
    
    if (userId) {
      const op = this.activeOperations.get(userId);
      if (op) {
        console.log(`   Cancelando operación: ${op.type} para usuario ${userId}`);
        if (op.type === 'navegacion' && op.resource) {
          op.resource.close().catch(() => {});
        } else if (op.type === 'comando' && op.resource) {
          try {
            process.kill(op.resource.pid, 'SIGKILL');
          } catch (e) {
            console.error('Error matando proceso:', e.message);
          }
        }
        this.activeOperations.delete(userId);
      }
    } else {
      // Cancelar todas las operaciones activas
      for (const [uid, op] of this.activeOperations) {
        console.log(`   Cancelando operación: ${op.type} para usuario ${uid}`);
        if (op.type === 'navegacion' && op.resource) {
          op.resource.close().catch(() => {});
        } else if (op.type === 'comando' && op.resource) {
          try {
            process.kill(op.resource.pid, 'SIGKILL');
          } catch (e) {
            console.error('Error matando proceso:', e.message);
          }
        }
      }
      this.activeOperations.clear();
    }
  }

  // Verificar si se solicitó cancelación para un usuario
  isCancelled(userId) {
    return this.cancelRequested || this.activeOperations.has(userId);
  }

  // Registrar un recurso de navegación
  registerNavigation(userId, browser) {
    this.activeOperations.set(userId, { type: 'navegacion', resource: browser });
  }

  // Registrar un proceso de comando
  registerCommand(userId, childProcess) {
    this.activeOperations.set(userId, { type: 'comando', resource: childProcess });
  }

  // Resetear el estado de cancelación
  reset() {
    this.cancelRequested = false;
    console.log('🔄 [CANCEL] Estado de cancelación resetado');
  }
}

export const cancelService = new CancelService();
