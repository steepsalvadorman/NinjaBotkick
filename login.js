import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

async function startLogin() {
    console.log("🚀 Iniciando el navegador para el inicio de sesión en Kick...");
    console.log("⚠️  Por favor, inicia sesión manualmente en la ventana del navegador que se abrirá.");

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await page.goto('https://kick.com', { waitUntil: 'networkidle2' });

    console.log("⏳ Esperando a que inicies sesión...");

    // Esperar a que aparezca el menú de usuario (esto indica que el login fue exitoso)
    try {
        await page.waitForSelector('#main-nav-user-menu, .user-menu, [data-testid="user-menu-button"]', { timeout: 300000 }); // 5 minutos de tiempo límite
        console.log("✅ Inicio de sesión detectado!");
    } catch (e) {
        console.log("❌ Tiempo de espera agotado o no se detectó el inicio de sesión.");
        await browser.close();
        return;
    }

    const cookies = await page.cookies();
    const relevantCookies = ['kick_session', 'session_token', 'XSRF-TOKEN'];

    const cookieString = cookies
        .filter(c => relevantCookies.includes(c.name))
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

    if (cookieString) {
        updateEnvFile(cookieString);
        console.log("💾 Cookies guardadas correctamente en el archivo .env");
        console.log("Ahora puedes cerrar el navegador y ejecutar: npm start");
    } else {
        console.log("❌ No se pudieron extraer las cookies necesarias. Asegúrate de estar logueado.");
    }

    await browser.close();
}

function updateEnvFile(cookieString) {
    const envPath = path.resolve('.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }

    const cookieRegex = /^COOKIES=.*$/m;
    const newEntry = `COOKIES="${cookieString}"`;

    if (cookieRegex.test(envContent)) {
        envContent = envContent.replace(cookieRegex, newEntry);
    } else {
        envContent += `\n${newEntry}`;
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n');
}

startLogin();


