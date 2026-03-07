# 🤖 OpenGravity: Resumen Técnico para el Agente

Este documento ha sido generado para facilitar el traspaso de información entre agentes de Antigravity. OpenGravity es un agente autónomo que vive en este VPS y se comunica vía Telegram y WebSockets.

## 🏗️ Arquitectura Principal
- **Núcleo**: Node.js 22.
- **Base de Datos**: SQLite (`opengravity.db`) para historial de mensajes corto (últimos 15 mensajes por contexto).
- **Comunicación**: 
  - `telegramBot.js`: Interfaz de usuario principal.
  - `socketService.js`: Puerto 3300 para comunicación con el portátil del usuario.
- **Cerebro (AI Service)**:
  - **Primario**: OpenRouter (`anthropic/claude-3.5-sonnet`) - Soporta herramientas.
  - **Secundario (Fallback)**: Groq (`llama-3.3-70b-versatile`) - Solo chat, sin herramientas.

## 🛠️ Herramientas Implementadas (ToolService)
1.  **`ejecutar_comando`**: Bash en background (5 min timeout). Notifica por Telegram al finalizar. No devuelve output inmediato a la IA.
2.  **`ejecutar_script`**: Ejecución síncrona de JS/Python en `/sandbox` (30s timeout). Devuelve el resultado a la IA.
3.  **`navegar_web`**: Puppeteer. Acciones: `texto` (extrae contenido) y `captura` (envía foto por Telegram). `--no-sandbox` habilitado.
4.  **`enviar_correo`**: Integración con Gmail API (`gmail.js`).
5.  **Gestión de archivos**: `leer_archivo`, `escribir_archivo`, `listar_archivos`.

## ⚙️ Configuración (.env)
Variables críticas que deben estar presentes:
- `TELEGRAM_BOT_TOKEN`: Token del bot de Telegram.
- `OPENROUTER_KEY`: API Key para Claude.
- `GROQ_KEY`: API Key para Llama.
- `SOCKET_TOKEN`: Token de seguridad para la conexión VPS-Portátil.
- `GROQ_MODEL` & `OPENROUTER_MODEL`: Definición de modelos activos.

## 📜 Notas de Desarrollo Recientes
- **Seguridad**: Los comandos de sistema solo los puede ejecutar el `adminUserId` definido en `config.js` (6270304668).
- **Resiliencia**: 
  - Añadido guard para mensajes vacíos en Telegram para evitar crashes (Bad Request 400).
  - `execPromise` definido en `toolService.js` mediante `promisify`.
  - Carpeta `/sandbox` con permisos `777`.

## 📂 Estructura de Archivos
- `src/bot/`: Lógica de Telegram.
- `src/services/`: Lógica de negocio (IA, Herramientas, Sockets, Gmail).
- `src/config/`: Configuración centralizada.
- `sandbox/`: Carpeta para scripts temporales.

---
*Última actualización: 07 Marzo 2026*
