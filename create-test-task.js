// Script para crear una tarea de prueba
import { schedulerService } from './src/services/schedulerService.js';

const chatId = '6270304668'; // Tu usuario admin
const command = 'date';
const minutes = 1;
const description = 'Mostrar la hora actual (prueba)';

try {
  const result = schedulerService.scheduleInMinutes(chatId, minutes, command, description);
  console.log('✅ Tarea creada exitosamente:');
  console.log('   ID:', result.jobId);
  console.log('   Ejecución:', result.executionTime.toLocaleString());
  console.log('\nEspera 1 minuto y revisa tu Telegram.');
} catch (error) {
  console.error('❌ Error creando tarea:', error.message);
}
