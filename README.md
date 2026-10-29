# Universal Discord Bot Manager

Panel autohospedado para conectar y administrar **bots de Discord que tú posees o tienes autorización para gestionar**. Incluye login OAuth2, almacenamiento cifrado de tokens, selección de servidores, miembros, envío de mensajes, lectura/borrado de mensajes, ban, kick y timeout.

## Requisitos
- Node.js 20 o superior.
- Una aplicación OAuth2 creada en [Discord Developer Portal](https://discord.com/developers/applications).
- Un servidor con HTTPS para producción.
- Los bots deben estar añadidos a los servidores que quieras administrar.

## 1. Configurar Discord OAuth2
En Discord Developer Portal, abre tu aplicación de dashboard (no necesariamente la aplicación de cada bot):
1. OAuth2 → General.
2. Copia Client ID y Client Secret.
3. Añade el Redirect URI exacto: `https://TU-DOMINIO/auth/callback`.
4. El login solicita `identify` y `guilds`.

La aplicación de dashboard no necesita Public Key para este flujo. La Public Key se utiliza para verificar interacciones HTTP de Discord y no autentica un bot.

## 2. Instalar
```bash
npm install
cp .env.example .env
```
Genera secretos:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Ejecuta el comando dos veces. Pega un valor en `SESSION_SECRET` (puede ser cualquier secreto largo) y otro de 64 caracteres hexadecimales en `MASTER_ENCRYPTION_KEY`.

Completa las variables de OAuth2 y `BASE_URL` en `.env`.

## 3. Ejecutar
```bash
npm start
```
Abre `http://localhost:3000`.

## 4. Añadir un bot
1. Inicia sesión con Discord.
2. Ve a Mis bots.
3. Pega el Bot Token de un bot que controles.
4. El backend intenta iniciar sesión en Discord y valida el token.
5. Elige el bot y un servidor.

El token se cifra con AES-256-GCM en SQLite. No se devuelve al navegador. No subas `.env`, `data/` ni copias de la base de datos a GitHub.

## Permisos y límites
- El usuario del dashboard debe iniciar sesión con Discord y tener `Manage Server` o `Administrator` en el servidor seleccionado.
- El bot necesita permisos propios: `View Channels`, `Send Messages`, `Read Message History`, `Ban Members`, `Kick Members` y/o `Moderate Members`, según la acción.
- La jerarquía de roles de Discord también se aplica.
- El endpoint de miembros requiere habilitar **Server Members Intent** en Developer Portal del bot.
- La lectura de contenido requiere **Message Content Intent** habilitado en Developer Portal. Discord puede restringir intents privilegiados a bots verificados.
- Discord impone rate limits y restricciones; no existe garantía de que todas las acciones funcionen en todos los servidores.

## Seguridad de producción
- Despliega detrás de HTTPS. En producción configura `NODE_ENV=production` y `BASE_URL` con HTTPS.
- Mantén `.env`, `data/manager.sqlite` y `data/sessions.sqlite` fuera del repositorio.
- Usa un disco persistente en tu hosting; si se pierde la base de datos, se pierden las conexiones registradas.
- Restringe el acceso al servidor y protege la cuenta Discord con 2FA.
- El token del bot equivale a una contraseña: si se filtra, regenera el token en Developer Portal inmediatamente.
- Para un servicio público multiusuario, añade límites por usuario, auditoría persistente, protección CSRF/origin, gestión de secretos con KMS/Vault, alertas y aislamiento por proceso/contenedor.
- Esta versión mantiene las conexiones de bots en memoria: al reiniciar el proceso, usa el botón de reconexión o vuelve a conectar desde el backend. La reconexión automática persistente y el escalado horizontal requieren un worker/gestor de procesos adicional.

## Importante
Un bot actúa como **bot**, no como una cuenta humana. No puede saltarse permisos, jerarquía, restricciones de Discord ni actuar como una cuenta de usuario normal. Nunca pegues un token en un chat, navegador de terceros o repositorio.
