import fs from 'fs/promises';
import readline from 'readline';
import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

// Cargar las credenciales del cliente desde un archivo local.
async function authorize() {
  let credentials;
  try {
    const content = await fs.readFile(CREDENTIALS_PATH);
    credentials = JSON.parse(content);
  } catch (err) {
    console.error(`Error loading client secret file: ${err}`);
    throw err;
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  // Verificar si tenemos previamente un token guardado.
  try {
    const token = await fs.readFile(TOKEN_PATH);
    oAuth2Client.setCredentials(JSON.parse(token));
    return oAuth2Client;
  } catch (err) {
    return getNewToken(oAuth2Client);
  }
}

// Obtener un nuevo token pidiendo permiso al usuario.
function getNewToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, async (err, token) => {
        if (err) {
          console.error('Error retrieving access token', err);
          return reject(err);
        }
        oAuth2Client.setCredentials(token);
        // Guardar el token al disco para ejecuciones futuras
        try {
          await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
          console.log(`Token stored to ${TOKEN_PATH}`);
          resolve(oAuth2Client);
        } catch (err) {
          console.error(err);
          reject(err);
        }
      });
    });
  });
}

// Listar los últimos 3 mensajes
async function listRecentMessages(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 3,
    });
    const messages = res.data.messages;
    if (!messages || messages.length === 0) {
      console.log('No messages found.');
      return;
    }
    console.log('--- Last 3 Messages ---');
    for (const message of messages) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date']
      });
      const headers = msg.data.payload.headers;
      const subject = headers.find((h) => h.name === 'Subject')?.value || 'No Subject';
      const from = headers.find((h) => h.name === 'From')?.value || 'Unknown Sender';
      const date = headers.find((h) => h.name === 'Date')?.value || 'Unknown Date';
      console.log(`\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}`);
    }
  } catch (error) {
    console.error('The API returned an error:', error);
  }
}

export async function enviarCorreo(destinatario, asunto, cuerpo) {
  const auth = await authorize();
  const gmail = google.gmail({ version: 'v1', auth });

  // Codificar el asunto en Base64 para soportar caracteres especiales (UTF-8)
  const utf8Subject = `=?utf-8?B?${Buffer.from(asunto).toString('base64')}?=`;
  
  const messageParts = [
    `To: ${destinatario}`,
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    cuerpo,
  ];

  const message = messageParts.join('\n');
  // Usar base64url como requiere la API de Gmail
  const encodedMessage = Buffer.from(message).toString('base64url');

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });
    console.log(`Correo enviado con éxito a ${destinatario}. Mensaje ID: ${res.data.id}`);
    return res.data;
  } catch (error) {
    console.error('Error al enviar el correo:', error);
    throw error;
  }
}

async function main() {
  try {
    const auth = await authorize();
    await listRecentMessages(auth);
  } catch (err) {
    console.error('Error starting Gmail integration:', err);
  }
}

// main();
