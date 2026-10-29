# Universal Discord Bot Manager — GitHub Pages + backend

Este repositorio separa el frontend estático (GitHub Pages) del backend Node.js (hosting que ejecute Node.js). GitHub Pages **no ejecuta Node.js**, no guarda tokens de bots y no puede realizar moderación por sí solo.

## Estructura
- `docs/`: frontend publicado por GitHub Pages.
- `src/`: API y conexión Discord, se ejecutan en el hosting backend.
- `package.json`: dependencias del backend.
- `.env.example`: plantilla de configuración; nunca subas `.env`.

## A. Publicar el frontend en GitHub Pages
1. Sube todo el contenido del ZIP a la raíz del repositorio, conservando las carpetas `docs/` y `src/`.
2. Abre GitHub → tu repositorio → **Settings → Pages**.
3. En **Build and deployment**, elige **Deploy from a branch**.
4. Branch: `main`; Folder: `/docs`; pulsa **Save**.
5. Tu web tendrá una URL como `https://TU-USUARIO.github.io/TU-REPOSITORIO/`.
6. Edita `docs/config.js` y cambia `https://YOUR-BACKEND-DOMAIN` por la URL HTTPS real de tu backend. Guarda y sube el cambio.

## B. Desplegar el backend
Necesitas un servicio/servidor que ejecute Node.js 20+ y conserve archivos entre reinicios (SQLite).
1. Sube el repositorio a un hosting Node.js o despliega el proyecto desde GitHub.
2. Comando de instalación: `npm install`.
3. Comando de inicio: `npm start`.
4. Configura las variables de entorno del apartado C.
5. Asegúrate de que el hosting tenga disco persistente para `data/manager.sqlite` y `data/sessions.sqlite`.

## C. Crear OAuth2 de Discord
En Discord Developer Portal crea/elige una aplicación para el login del panel:
1. Copia **Client ID** y **Client Secret** de OAuth2.
2. En OAuth2 → Redirects añade exactamente `https://TU-BACKEND-DOMAIN/auth/callback`.
3. El backend usa scopes `identify` y `guilds`.

En las variables del backend configura:
- `FRONTEND_URL=https://TU-USUARIO.github.io/TU-REPOSITORIO`
- `ALLOWED_ORIGIN=https://TU-USUARIO.github.io` (solo el origen, sin la ruta del repositorio)
- `DISCORD_REDIRECT_URI=https://TU-BACKEND-DOMAIN/auth/callback`
- `DISCORD_CLIENT_ID` y `DISCORD_CLIENT_SECRET`
- `NODE_ENV=production`
- `SESSION_SECRET`: secreto largo aleatorio.
- `MASTER_ENCRYPTION_KEY`: exactamente 64 caracteres hexadecimales (32 bytes).
- `DATA_DIR=/data` para que la base de datos y las sesiones sobrevivan a los despliegues de FadeHost.

Genera un secreto hexadecimal con:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Ejecuta dos veces para obtener valores independientes. No publiques los valores.

## D. Conectar bots
1. Abre el enlace GitHub Pages.
2. Inicia sesión con Discord.
3. Ve a “Mis bots” y pega el token de un bot que controles.
4. Selecciona el bot y el servidor.

El token del bot se cifra en el backend mediante AES-256-GCM. No se guarda en GitHub Pages, `config.js`, HTML ni JavaScript.

## Permisos / límites
- El usuario que inicia sesión debe tener `Manage Server` o `Administrator` en el servidor.
- El bot necesita permisos propios para cada acción (Ban Members, Kick Members, Moderate Members, Send Messages, Read Message History, Manage Messages).
- Para listar miembros activa Server Members Intent en Developer Portal del bot.
- Para leer contenido de mensajes activa Message Content Intent, sujeto a las restricciones de Discord.
- Discord aplica jerarquía de roles, rate limits e intents privilegiados.
- El bot opera como bot, no como cuenta humana.

## Seguridad
- Usa HTTPS para frontend y backend.
- Nunca subas `.env`, la carpeta `data/` ni bases de datos.
- Mantén `MASTER_ENCRYPTION_KEY` y `SESSION_SECRET` privados y con copias de seguridad seguras. Si pierdes la clave maestra, no podrás descifrar los tokens almacenados.
- Usa hosting de confianza, restringe acceso y protege Discord con 2FA.
- Esta es una base funcional inicial, no una auditoría de seguridad ni una plataforma multiusuario lista para vender públicamente. Antes de abrirla al público añade auditoría, límites por usuario, alertas, protección operativa y revisión de seguridad.

## Nota sobre Public Key
La Discord Application Public Key verifica firmas de interacciones HTTP de Discord. No sustituye al Bot Token ni al OAuth2 Client Secret. El flujo de este proyecto usa Bot Token para la sesión del bot y OAuth2 para identificar al administrador.
