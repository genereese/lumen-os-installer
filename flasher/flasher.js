// Lumen OS web installer (Web Serial + esptool-js).
import { ESPLoader, Transport } from 'https://unpkg.com/esptool-js@0.7.1/bundle.js';
import { guessZone } from '../web/js/tz.js';
import { initSmoothDetails, toggleDetails } from '../web/js/smooth-details.js';

initSmoothDetails();

const $ = (id) => document.getElementById(id);
const logEl = $('log');
const log = (s) => { logEl.textContent += s; logEl.scrollTop = logEl.scrollHeight; };
const logLine = (s) => log(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Flash speeds, fastest first. After a failed attempt we step down one.
const SPEEDS = [921600, 460800, 230400, 115200];
const MAX_ATTEMPTS = 4;

let port = null, transport = null, loader = null, chipName = '', manifest = null, build = null, usbOtg = false;
let baud = 460800;
let serialReader = null, serialWriter = null, serialBuf = '';

if (!('serial' in navigator)) {
  $('unsupported').hidden = false;
  $('connect').disabled = true;
}

const terminal = { clean() {}, writeLine: logLine, write: log };

// ---------------------------------------------------------------- tabs
// One card, four panels on a sliding track. The card's height follows the
// visible panel so nothing jumps.
const tabs = [...document.querySelectorAll('.tab')];
const panels = [...document.querySelectorAll('.panel')];
const track = document.querySelector('.track');
const viewport = document.querySelector('.viewport');
const ink = document.querySelector('.ink');
let current = 0;
// The card has its natural height (so content that grows - chip details, the
// progress bar, an opening hint - is never cut off). Only while sliding to
// another tab is the height pinned and animated from one panel to the other.
let slideTimer = null;
function go(n) {
  const from = viewport.getBoundingClientRect().height;
  const prev = panels[current];
  if (prev && current !== n) prev.classList.add('leaving');
  current = n;
  tabs.forEach((t, i) => { t.classList.toggle('on', i === n); t.setAttribute('aria-selected', i === n); if (i === n) t.disabled = false; });
  panels.forEach((p, i) => { p.classList.toggle('on', i === n); p.inert = i !== n; });
  track.style.transform = `translateX(-${n * 25}%)`;
  ink.style.transform = `translateX(${n * 100}%)`;
  const to = panels[n].offsetHeight;
  clearTimeout(slideTimer);
  viewport.style.height = from + 'px';
  void viewport.offsetHeight;
  viewport.style.height = to + 'px';
  slideTimer = setTimeout(() => {
    viewport.style.height = 'auto';
    panels.forEach((p) => p.classList.remove('leaving'));
  }, 520);
}
const enable = (n) => { tabs[n].disabled = false; };
const markDone = (n) => tabs[n].classList.add('done');
tabs.forEach((t, i) => t.onclick = () => go(i));
go(0);

function finish({ connected, ssid, ip, host, ap, clock }) {
  const list = [];
  list.push(['✓', `Lumen OS ${manifest?.version || ''} installed`]);
  if (connected) list.push(['📶', `On Wi-Fi <b>${esc(ssid)}</b> at ${esc(ip)}`]);
  else list.push(['📡', `Setup network <b>${esc(ap || 'Lumen-XXXX')}</b> is on: join it, then open http://192.168.4.1`]);
  if (clock) list.push(['🕒', `Clock set · ${esc(clock)}`]);
  $('done-list').innerHTML = list.map(([i, t]) => `<li><span>${i}</span><span>${t}</span></li>`).join('');
  $('done-text').textContent = connected ? 'Open the desktop from any device on your network.' : 'Connect to the board\'s own network to finish setting it up.';
  $('done-link').innerHTML = connected
    ? `<a class="go" href="http://${esc(ip)}/" target="_blank">Open Lumen OS →</a><p class="status" style="margin:10px 0 0">or http://${esc(host)}.local/</p>`
    : '';
  enable(3);
  go(3);
}
// A dialog in the installer's own style (instead of the browser's
// alert/confirm boxes). Resolves true for the main button, false otherwise.
function dialog({ title, text, ok = 'OK', cancel = null, danger = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
      <div class="dlg-icon ${danger ? 'danger' : ''}">${danger ? '!' : 'i'}</div>
      <h3 id="dlg-t"></h3><p></p>
      <div class="dlg-actions">${cancel ? '<button class="dlg-cancel"></button>' : ''}<button class="dlg-ok ${danger ? 'danger' : 'primary'}"></button></div></div>`;
    back.querySelector('h3').textContent = title;
    back.querySelector('p').textContent = text;
    back.querySelector('.dlg-ok').textContent = ok;
    if (cancel) back.querySelector('.dlg-cancel').textContent = cancel;
    document.body.append(back);
    const close = (v) => {
      back.classList.add('out');
      removeEventListener('keydown', key, true);
      setTimeout(() => back.remove(), 180);
      resolve(v);
    };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(false); } };
    addEventListener('keydown', key, true);
    back.querySelector('.dlg-ok').onclick = () => close(true);
    back.querySelector('.dlg-cancel')?.addEventListener('click', () => close(false));
    back.onclick = (e) => { if (e.target === back) close(false); };
    (cancel ? back.querySelector('.dlg-cancel') : back.querySelector('.dlg-ok')).focus();
  });
}

// "about 1 min 20 s left"
function fmtLeft(sec) {
  sec = Math.max(1, Math.round(sec));
  if (sec < 60) return `about ${sec} s left`;
  const m = Math.floor(sec / 60), r = Math.round((sec % 60) / 5) * 5;
  return `about ${m} min${r ? ` ${r} s` : ''} left`;
}

function msg(el, html, cls) { el.innerHTML = `<div class="msg ${cls}">${html}</div>`; }
const slower = (b) => SPEEDS.find((s) => s < b) || 115200;

async function loadManifest() {
  const r = await fetch('../dist/manifest.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('dist/manifest.json not found. Build the firmware first.');
  return r.json();
}

// (Re)open the bootloader connection on the already-chosen port.
async function openLoader(speed) {
  await closeLoader();
  transport = new Transport(port, true);
  loader = new ESPLoader({ transport, baudrate: speed, terminal, debugLogging: false });
  chipName = await loader.main();
  baud = speed;
  usbOtg = await loader.usesUsbOtg().catch(() => false);
}

async function closeLoader() {
  try { await transport?.disconnect(); } catch { /* already closed */ }
  transport = null;
  loader = null;
}

// ---------------------------------------------------------------- connect
$('connect').onclick = async () => {
  $('connect').disabled = true;
  $('conn-status').textContent = 'Choose the port…';
  try {
    manifest ||= await loadManifest();
    await closeSerial();
    if (!port) port = await navigator.serial.requestPort();
    $('conn-status').textContent = 'Talking to the bootloader…';
    let speed = 460800;                   // steps down automatically if the link is unreliable
    for (let attempt = 1; ; attempt++) {
      try {
        await openLoader(speed);
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        speed = slower(speed);
        logLine(`Connect attempt ${attempt} failed (${e.message || e}); retrying at ${speed} baud…`);
        $('conn-status').textContent = `Retrying (${attempt + 1}/3)…`;
        await sleep(600);
      }
    }
    const flashSize = await loader.detectFlashSize().catch(() => '?');
    const mac = await loader.chip.readMac(loader).catch(() => '?');
    // Chip family ("ESP32", "ESP32-S3"); main() returns the full part name.
    const family = (loader.chip.CHIP_NAME || chipName.replace(/\s*\(.*$/, '')).trim().toUpperCase();
    build = manifest.builds.find((b) => b.chip.toUpperCase() === family);
    const info = $('chip-info');
    info.innerHTML = `<dt>Chip</dt><dd>${esc(chipName)}</dd><dt>Flash</dt><dd>${esc(flashSize)}</dd><dt>MAC</dt><dd>${esc(mac)}</dd><dt>Speed</dt><dd>${baud} baud</dd>`;
    info.hidden = false;
    $('conn-status').textContent = 'Connected';
    $('disconnect').hidden = false;
    markDone(0);
    enable(1);
    go(1);
    if (!build) {
      $('install').disabled = true;
      $('fw-desc').hidden = false;
      $('fw-desc').innerHTML = `<span class="msg err" style="display:block">No Lumen OS build for ${esc(family)} in dist/. Available: ${esc(manifest.builds.map((b) => b.chip).join(', ') || 'none')}.</span>`;
      return;
    }
    // The partition table needs a minimum flash size (4 MB ESP32, 8 MB S3).
    const mb = parseInt(flashSize, 10);
    if (build.min_flash_mb && mb && mb < build.min_flash_mb) {
      $('install').disabled = true;
      $('fw-desc').hidden = false;
      $('fw-desc').innerHTML = `<span class="msg err" style="display:block">This board has ${esc(flashSize)} of flash, but Lumen OS for the ${esc(family)} needs at least ${build.min_flash_mb} MB. It would install but not work properly, so installing is turned off. Look for a board with ${build.min_flash_mb} MB or more (often printed on the module, e.g. "N${build.min_flash_mb}" or "N16").</span>`;
      $('fw-size').textContent = '';
      return;
    }
    $('install').disabled = false;
    $('fw-desc').textContent = family === 'ESP32-C3' ? 'ESP32-C3 has a single core: MicroPython shares it with the OS at a lower priority.' : '';
    $('fw-desc').hidden = !$('fw-desc').textContent;
    $('fw-size').textContent = `${(build.size / 1048576).toFixed(2)} MB`;
  } catch (e) {
    $('conn-status').textContent = '';
    logLine('Error: ' + (e.message || e));
    if (!$('log-box').open) toggleDetails($('log-box'), true);
    dialog({ title: 'Could not connect', text: `${e.message || e}. Try another cable or USB port, or hold BOOT while tapping RESET and try again.`, ok: 'OK' });
    await closeLoader();
    port = null;   // let the user pick a different port next time
    $('connect').disabled = false;
  }
};

$('disconnect').onclick = async () => {
  await closeSerial();
  await closeLoader();
  location.reload();
};

// ---------------------------------------------------------------- install
function md5(image) {
  // crypto-js is loaded from cdnjs; without it, esptool-js skips verification.
  return globalThis.CryptoJS ? CryptoJS.MD5(CryptoJS.lib.WordArray.create(image)).toString() : undefined;
}

$('install').onclick = async () => {
  if (!build) return;
  const erase = document.querySelector('input[name=mode]:checked').value === 'erase';
  if (erase && !(await dialog({ title: 'Erase everything?', text: 'A clean install erases the whole board first, including all of its files and settings. This cannot be undone.', ok: 'Erase and install', cancel: 'Cancel', danger: true }))) return;
  $('install').disabled = true;
  $('progress').hidden = false;
  const text = $('progress-text');
  const bar = $('bar');
  try {
    text.textContent = 'Downloading firmware…';
    const get = async (file) => {
      const r = await fetch('../dist/' + file, { cache: 'no-store' });
      if (!r.ok) throw new Error('Could not load ' + file);
      return new Uint8Array(await r.arrayBuffer());
    };
    // Clean install: one image from address 0 (it blanks the settings area,
    // which the erase did anyway). Update: only the bootloader, partition
    // table and app, so Wi-Fi and other settings survive. The S3's boot-slot
    // record is blanked too, so a board that had other firmware (with its
    // own update slots) always starts Lumen.
    const files = erase || !build.parts?.length
      ? [{ data: await get(build.file), address: 0 }]
      : [
          ...(await Promise.all(build.parts.map(async (pt) => ({ data: await get(pt.file), address: pt.address })))),
          ...(build.blank || []).map((b) => ({ data: new Uint8Array(b.size).fill(0xff), address: b.address })),
        ];
    const data = { length: files.reduce((n, f) => n + f.data.length, 0) };
    const before = files.map((_, i) => files.slice(0, i).reduce((n, f) => n + f.data.length, 0));
    let erased = false;
    // Serial carries ~10 bits per byte; compression roughly halves the image,
    // and the chip spends some time writing flash between blocks.
    const guessWrite = () => (data.length * 0.6) / (baud / 10) + 4;
    const eraseGuess = 25;
    text.textContent = `Preparing… ${fmtLeft(guessWrite() + (erase ? eraseGuess : 0))}`;

    for (let attempt = 1; ; attempt++) {
      try {
        if (!loader) await openLoader(baud);
        if (erase && !erased) {
          const t0 = performance.now();
          const tick = setInterval(() => {
            const el = (performance.now() - t0) / 1000;
            const left = Math.max(eraseGuess - el, 3) + guessWrite();
            text.textContent = `Erasing the board… ${fmtLeft(left)}`;
            bar.style.width = Math.min(15, (el / eraseGuess) * 15) + '%';
          }, 500);
          try { await loader.eraseFlash(); } finally { clearInterval(tick); }
          erased = true;
        }
        bar.style.width = '0%';
        const w0 = performance.now();
        let shown = null;
        await loader.writeFlash({
          fileArray: files,
          flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
          eraseAll: false, compress: true,
          calculateMD5Hash: globalThis.CryptoJS ? md5 : undefined,
          reportProgress: (i, written, total) => {
            const frac = (before[i] + (written / total) * files[i].data.length) / data.length;
            const pct = Math.round(frac * 100);
            bar.style.width = pct + '%';
            const el = (performance.now() - w0) / 1000;
            // Measured rate once a little has been written, smoothed so the
            // estimate doesn't jump around; plus a few seconds to verify.
            const est = frac > 0.04 ? (el / frac) * (1 - frac) + 2 : guessWrite();
            shown = shown == null ? est : shown + (est - shown) * 0.25;
            text.textContent = `Writing Lumen OS… ${pct}% · ${fmtLeft(shown)}` + (attempt > 1 ? ` (attempt ${attempt}, ${baud} baud)` : '');
          },
        });
        break;
      } catch (e) {
        logLine(`Attempt ${attempt} failed: ${e.message || e}`);
        if (attempt >= MAX_ATTEMPTS) throw e;
        // Most failures are line noise: reconnect more slowly and try again.
        const next = slower(baud);
        text.textContent = `Connection hiccup, reconnecting at ${next} baud…`;
        await closeLoader();
        await sleep(800);
        await openLoader(next);
      }
    }

    text.textContent = 'Restarting the board…';
    await loader.after('hard_reset', usbOtg);
    await closeLoader();
    markDone(1);
      text.innerHTML = '<b>Installed and verified.</b> Lumen OS is starting.';
    // Move the user on to Wi-Fi setup.
    await sleep(900);
    go(2);
    if (usbOtg) {
      msg($('wifi-result'), 'This board uses native USB, so it reconnects as a new port after restarting. Click <b>Scan for networks</b> and pick the port again.', 'warn');
      $('wifi-scan').focus();
    } else {
      // Same port as before: give Lumen OS a moment to boot, then scan.
      $('scan-status').textContent = 'Waiting for the board to start…';
      setTimeout(() => $('wifi-scan').click(), 3500);
    }
  } catch (e) {
    logLine('Error: ' + (e.message || e));
    if (!$('log-box').open) toggleDetails($('log-box'), true);
    text.innerHTML = `<span style="color:var(--danger)">Install failed: ${esc(e.message || e)}. Try another USB cable or port, then click Install again.</span>`;
    await closeLoader();
  } finally {
    $('install').disabled = false;
  }
};

// ---------------------------------------------------------------- serial REPL (Wi-Fi setup)
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);

// Progress for the Wi-Fi tab ("Opening the port…").
function step(text) { $('scan-status').innerHTML = text ? `<span class="spin-sm"></span>${esc(text)}` : ''; }

// Talk to Lumen OS's REPL over USB. Works right after installing, and for a
// board that already runs Lumen (no install on this page).
async function openSerial() {
  if (serialWriter) return;
  // "Connect" (tab 1) left the board in its bootloader: restart it into Lumen.
  if (loader) {
    step('Restarting the board into Lumen OS…');
    try { await loader.after('hard_reset', usbOtg); } catch { /* reset by hand if needed */ }
    await closeLoader();
    await sleep(usbOtg ? 300 : 3000);
  }
  await closeLoader();
  if (!port || usbOtg) {
    step('Choose the board’s USB port in the browser’s window…');
    try { port = await navigator.serial.requestPort(); } catch { throw new Error('No port was chosen.'); }
    usbOtg = false;
  }
  if (!port.readable) {
    step('Opening the port…');
    await withTimeout(port.open({ baudRate: 115200 }), 5000,
      'The port could not be opened. Close other programs or browser tabs that use it (another installer tab, a serial monitor) and try again.');
    // Keep EN/IO0 released so the board keeps running (auto-reset circuits).
    await port.setSignals({ dataTerminalReady: false, requestToSend: false }).catch(() => {});
  }
  serialWriter = port.writable.getWriter();
  serialReader = port.readable.getReader();
  (async () => {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await serialReader.read();
        if (done) break;
        const t = dec.decode(value, { stream: true });
        serialBuf = (serialBuf + t).slice(-20000);
        log(t);
      }
    } catch { /* port closed */ }
  })();
}

// Wait for MicroPython's ">>>" prompt. Pressing Enter shows it if Python is
// idle; while the board is still starting we keep trying. If a program is
// running, ask before stopping it (Ctrl-C) instead of stopping it silently.
let allowStop = false;
async function waitPrompt(maxMs = 12000) {
  const t0 = Date.now();
  let asked = false, said = false;
  while (Date.now() - t0 < maxMs) {
    if (!said && Date.now() - t0 > 900) { said = true; step('Waiting for Lumen OS…'); }
    serialBuf = '';
    await send('\r');
    for (let i = 0; i < 8; i++) {
      await sleep(100);
      if (/>>> ?$/.test(serialBuf.replace(/\r/g, '').trimEnd() + ' ') || serialBuf.includes('>>> ')) return;
    }
    if (!asked && Date.now() - t0 > 3000 && !allowStop) {
      asked = true;
      const ok = await dialog({ title: 'A program seems to be running', text: 'The board is running a Python program, so it cannot answer right now. Stop the program to continue? (It starts again at the next restart if it runs at boot.)', ok: 'Stop it', cancel: 'Cancel' });
      if (!ok) throw new Error('Cancelled: the program on the board was left running.');
      allowStop = true;
    }
    if (allowStop) { await send('\x03\x03'); await sleep(200); }
  }
  throw new Error('Lumen OS did not answer over USB. Check that this is the right port and that the board is running Lumen OS (try unplugging it and plugging it back in).');
}

async function closeSerial() {
  try { await serialReader?.cancel(); } catch { /* ignore */ }
  try { serialReader?.releaseLock(); serialWriter?.releaseLock(); } catch { /* ignore */ }
  if (serialReader || serialWriter) { try { await port?.close(); } catch { /* ignore */ } }
  serialReader = serialWriter = null;
}

const send = (s) => serialWriter.write(new TextEncoder().encode(s));
const pyStr = (s) => JSON.stringify(s);   // JSON strings are valid Python string literals

// Run one line at the REPL and return what it printed between markers.
// Run one line at the REPL and return what it printed between markers.
async function replRun(code, waitMs = 4000) {
  const before = $('scan-status').innerHTML;
  await waitPrompt();
  if ($('scan-status').innerHTML !== before) $('scan-status').innerHTML = before;   // back to the caller's message
  serialBuf = '';
  await send(`print('<<'+'L>>');${code};print('<<'+'E>>')\r`);
  for (let t = 0; t < waitMs; t += 100) {
    await sleep(100);
    const m = serialBuf.match(/<<L>>\r?\n([\s\S]*?)<<E>>/);
    if (m) return m[1].trim();
    const err = serialBuf.match(/Traceback[\s\S]*?\n(\w+Error[^\r\n]*)/);
    if (err) throw new Error(err[1]);
  }
  throw new Error('The board did not answer in time. Is Lumen OS running on it?');
}

function bars(rssi) {
  const n = rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : 1;
  return `<span class="sig" title="${rssi} dBm">${[5, 8, 11, 14].map((h, i) => `<i class="${i < n ? 'on' : ''}" style="height:${h}px"></i>`).join('')}</span>`;
}

$('wifi-scan').onclick = async () => {
  const btn = $('wifi-scan');
  btn.disabled = true;
  $('scan-status').textContent = 'Scanning…';
  try {
    await openSerial();
    step('Scanning for networks…');
    let list;
    try {
      list = JSON.parse(await replRun('import lumen,json;print(json.dumps(lumen.wifi_scan()))', 15000));
    } catch (e) {
      if (!/AttributeError/.test(e.message)) throw e;
      // Older firmware: fall back to MicroPython's network module.
      list = JSON.parse(await replRun("import network,json;print(json.dumps([[s[0].decode(),s[3],s[2],s[4]>0] for s in network.WLAN(network.STA_IF).scan()]))", 15000));
    }
    const box = $('nets');
    box.hidden = false;
    if (!list.length) {
      box.innerHTML = '<div class="msg warn" style="margin:0">No networks found. Move the board closer to the router and scan again.</div>';
    } else {
      box.innerHTML = list.map(([ssid, rssi, ch, secure], i) =>
        `<button type="button" data-i="${i}">${bars(rssi)}<span class="ssid">${esc(ssid)}</span><span class="sub">${secure ? '🔒' : 'open'} · ch ${ch}</span></button>`).join('');
      box.querySelectorAll('button').forEach((b) => b.onclick = () => {
        const [ssid, , , secure] = list[b.dataset.i];
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        $('ssid').value = ssid;
        $('pass').value = '';
        $('pass').placeholder = secure ? 'Wi-Fi password' : 'No password needed';
        (secure ? $('pass') : $('wifi-save')).focus();
      });
    }
    $('scan-status').textContent = `${list.length} network(s)`;
  } catch (e) {
    $('scan-status').textContent = '';
    msg($('wifi-result'), esc(e.message), 'err');
  } finally {
    btn.disabled = false;
  }
};

$('wifi-form').onsubmit = async (e) => {
  e.preventDefault();
  const ssid = $('ssid').value, pass = $('pass').value;
  $('wifi-save').disabled = true;
  try {
    await openSerial();
    step(`Saving ${ssid}…`);
    await replRun(`import lumen;lumen.wifi_connect(${pyStr(ssid)},${pyStr(pass)})`);
    $('pass').value = '';
    msg($('wifi-result'), `Saved. The board is joining <b>${esc(ssid)}</b>… checking in a few seconds.`, 'ok');
    await sleep(6000);
    await checkWifi();
  } catch (err) {
    msg($('wifi-result'), esc(err.message), 'err');
  } finally {
    $('wifi-save').disabled = false;
    step('');
  }
};

async function checkWifi() {
  await openSerial();
  step('Checking the connection…');
  const ask = async () => JSON.parse((await replRun("import lumen,json;w=lumen.wifi_status();w['host']=lumen.hostname();print(json.dumps(w))")).split('\n').pop());
  let w = await ask();
  // Opening the USB port restarts many boards (their auto-reset circuit), and
  // right after a restart the board is still joining its network: keep asking
  // for a while before saying it isn't connected.
  const t0 = Date.now(), LIMIT = 30000;
  while (!w.connected && w.ssid && Date.now() - t0 < LIMIT) {
    const left = Math.ceil((LIMIT - (Date.now() - t0)) / 1000);
    msg($('wifi-result'), `<span class="spin-sm"></span> Waiting for the board to join <b>${esc(w.ssid)}</b>… (up to ${left} s)`, 'ok');
    await sleep(1000);
    w = await ask();
  }
  $('ap-name').textContent = w.ap_ssid;
  if (w.connected) {
    msg($('wifi-result'), `<b>All set!</b> Connected to <b>${esc(w.ssid)}</b>.<br><br>
      <a href="http://${esc(w.ip)}/" target="_blank" style="display:inline-block;padding:10px 18px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600">Open Lumen OS →</a>
      <span class="sub" style="margin-left:10px">or http://${esc(w.host)}.local/</span>`, 'ok');
    markDone(2);
    finish({ connected: true, ssid: w.ssid, ip: w.ip, host: w.host, clock: await setClock() });
  } else {
    msg($('wifi-result'), `Not connected to Wi-Fi${w.ssid ? `: the board could not join "${esc(w.ssid)}" within 30 seconds. Check the password and that the router is in range, then save the network again` : ' yet: choose a network above'}. Setup network <b>${esc(w.ap_ssid)}</b> ${w.ap_active ? 'is on at http://' + esc(w.ap_ip) + '/' : 'is off'}.`, 'warn');
  }
}

// Set the board's clock and time zone from this computer (it has no
// battery-backed clock; it also syncs from the internet once on Wi-Fi).
async function setClock() {
  const z = guessZone();
  try {
    await replRun(`import lumen;lumen.set_time(${Math.floor(Date.now() / 1000)},${pyStr(z.tz)},${pyStr(z.name)})`);
    return `${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ${z.name}`;
  } catch { return ''; }      // older firmware without set_time
}

$('wifi-skip').onclick = async () => {
  let ap = '', clock = '';
  try {
    if (port) {
      await openSerial();
      const w = JSON.parse((await replRun("import lumen,json;print(json.dumps(lumen.wifi_status()))")).split('\n').pop());
      ap = w.ap_ssid;
      clock = await setClock();
    }
  } catch { /* not connected over USB: still show the instructions */ }
  finish({ connected: false, ap: ap || $('ap-name').textContent, clock });
};

$('wifi-check').onclick = async () => {
  const b = $('wifi-check');
  b.disabled = true;
  try { await checkWifi(); } catch (err) { msg($('wifi-result'), esc(err.message || err), 'err'); } finally { b.disabled = false; step(''); }
};



// ---------------------------------------------------------------- background
// The desktop's "Silk" wallpaper on a dark background: a soft nebula glow and
// ribbons of fine, slowly twisting threads. Still when the system asks for
// reduced motion.
(function silk() {
  const cv = document.getElementById('sky');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0;
  const resize = () => {
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduced.matches) draw(performance.now());
  };
  const HUE = 228;
  let last = 0, t = 8;
  function draw(now) {
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    t += (dt / 1000) * 2;                        // the desktop's default 3x feels rushed here
    const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, '#171b38');
    bg.addColorStop(1, '#07080f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, dh] of [[0.3, 0.35, 0.55, 0], [0.75, 0.6, 0.5, 70]]) {
      const n = ctx.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * r);
      n.addColorStop(0, `hsla(${HUE + dh} 90% 50% / .30)`);
      n.addColorStop(1, `hsla(${HUE + dh} 90% 40% / 0)`);
      ctx.fillStyle = n;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ribbons = [{ y: 0.42, amp: 0.16, dh: 0, ph: 0, sp: 0.11 }, { y: 0.62, amp: 0.12, dh: 70, ph: 2.4, sp: 0.08 }];
    for (const rb of ribbons) {
      for (let i = 0; i < 28; i++) {
        const f = i / 28;
        const twist = Math.sin(t * rb.sp * 3 + f * Math.PI + rb.ph);
        ctx.beginPath();
        for (let x = -20; x <= W + 20; x += 14) {
          const u = x / W;
          const y = H * (rb.y + Math.sin(u * 3.2 + t * rb.sp + rb.ph) * rb.amp + Math.sin(u * 7 - t * rb.sp * 1.4 + f * 2) * rb.amp * 0.18 * twist)
            + (f - 0.5) * H * 0.09 * Math.sin(u * 2.4 + t * rb.sp * 0.8 + rb.ph);
          x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `hsla(${HUE + rb.dh + f * 40} 90% 68% / ${0.2 * (0.4 + 0.6 * Math.sin(f * Math.PI))})`;
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
    }
    ctx.restore();
    const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.5, Math.max(W, H) * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,.4)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }
  resize();
  addEventListener('resize', resize);
  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || reduced.matches) return;
    if (now - last < 33) return;
    draw(now);
  }
  draw(performance.now());
  requestAnimationFrame(loop);
})();
