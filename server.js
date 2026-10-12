const http = require('http');
const fs = require('fs');
const path = require('path');

const API = 'https://api.tcgdex.net/v2/fr';
const cache = new Map();

async function get(url) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  cache.set(url, data);
  return data;
}

const pad = (id, total) =>
  /^\d+$/.test(String(id)) && total ? String(id).padStart(String(total).length, '0') : String(id);

async function chercher(nom, num) {
  let local = null, total = null;
  const m = String(num || '').trim().match(/^(\w+)(?:\s*\/\s*(\d+))?$/);
  if (m) { local = m[1]; total = m[2] ? parseInt(m[2], 10) : null; }

  let liste = await get(`${API}/cards?name=${encodeURIComponent(nom)}`);
  if (!Array.isArray(liste)) liste = [];

  if (local) {
    const n = /^\d+$/.test(local) ? parseInt(local, 10) : null;
    liste = liste.filter((c) => {
      const id = String(c.localId || '');
      return n !== null ? /^\d+$/.test(id) && parseInt(id, 10) === n : id.toLowerCase() === local.toLowerCase();
    });
  }

  liste = liste.slice(0, 10);
  const details = await Promise.all(
    liste.map((c) => get(`${API}/cards/${encodeURIComponent(c.id)}`).catch(() => null))
  );

  let res = details.filter(Boolean).map((d) => {
    const off = d.set && d.set.cardCount ? d.set.cardCount.official : null;
    const numero = off ? `${pad(d.localId, off)}/${off}` : String(d.localId);
    const serie = d.set && d.set.name ? ` – ${d.set.name}` : '';
    return { id: d.id, official: off, image: d.image ? d.image + '/high.webp' : null, titre: `Carte Pokémon ${d.name} ${numero}${serie}` };
  });

  if (total) {
    const exact = res.filter((r) => r.official === total);
    if (exact.length) res = exact;
  }
  return res;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/titre') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const nom = (url.searchParams.get('nom') || '').trim();
    const num = (url.searchParams.get('num') || '').trim();
    if (!nom) { res.statusCode = 400; res.end(JSON.stringify({ erreur: 'Nom manquant.' })); return; }
    try {
      const resultats = await chercher(nom, num);
      res.end(JSON.stringify({ resultats, erreur: resultats.length ? undefined : 'Aucune carte trouvée.' }));
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ resultats: [], erreur: 'Recherche indisponible pour le moment.' }));
    }
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, buf) => {
      if (err) { res.statusCode = 500; res.end('Erreur'); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(buf);
    });
    return;
  }

  res.statusCode = 404;
  res.end('Introuvable');
});

server.listen(process.env.PORT || 3000, () => console.log('Catalogue prêt'));
