#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const SRC = path.join(__dirname, '..', 'brand', 'source-favicon.png');
const RES = path.join(__dirname, '..', 'resources');
const ICONS = path.join(RES, 'icons');

async function main() {
    if (!fs.existsSync(SRC)) {
        throw new Error(`source not found: ${SRC}`);
    }
    fs.mkdirSync(ICONS, { recursive: true });

    const master = await sharp(SRC)
        .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

    fs.writeFileSync(path.join(RES, 'icon.png'), await sharp(master).resize(512, 512).png().toBuffer());
    fs.writeFileSync(path.join(ICONS, '512x512.png'), await sharp(master).resize(512, 512).png().toBuffer());

    // Tray icons (system tray / macOS menu bar). @2x is for retina.
    fs.writeFileSync(path.join(RES, 'tray-icon.png'), await sharp(master).resize(16, 16).png().toBuffer());
    fs.writeFileSync(path.join(RES, 'tray-icon@2x.png'), await sharp(master).resize(32, 32).png().toBuffer());

    const icns = png2icons.createICNS(master, png2icons.BILINEAR, 0);
    if (!icns) throw new Error('createICNS returned null');
    fs.writeFileSync(path.join(RES, 'icon.icns'), icns);

    const ico = png2icons.createICO(master, png2icons.BILINEAR, 0, false);
    if (!ico) throw new Error('createICO returned null');
    fs.writeFileSync(path.join(RES, 'icon.ico'), ico);

    console.log('icons regenerated:');
    for (const f of ['icon.png', 'icon.icns', 'icon.ico', 'tray-icon.png', 'tray-icon@2x.png', 'icons/512x512.png']) {
        const p = path.join(RES, f);
        console.log(`  ${f}  ${fs.statSync(p).size} bytes`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
