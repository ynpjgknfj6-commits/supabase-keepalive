// Povlači službene cijene iz F1 Fantasyja i upisuje promijenjene u Supabase tablicu `prices`.
// Pokreće ga GitHub Actions (.github/workflows/sync-prices.yml); radi i ručno:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sync-prices.mjs
//   DRY_RUN=1 node scripts/sync-prices.mjs   (samo ispiše što bi upisao, bez ključa)
// Treba Node 20+ (ugrađeni fetch), bez dodatnih paketa.

const FANTASY = 'https://fantasy.formula1.com/feeds';
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const DRY_RUN = !!process.env.DRY_RUN;
const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Ime tima u službenoj igri → constructorId u aplikaciji (Jolpica).
const TEAMS = {
  mercedes: 'mercedes',
  'red bull racing': 'red_bull',
  'red bull': 'red_bull',
  mclaren: 'mclaren',
  ferrari: 'ferrari',
  alpine: 'alpine',
  'racing bulls': 'rb',
  'visa cash app rb': 'rb',
  'haas f1 team': 'haas',
  haas: 'haas',
  williams: 'williams',
  audi: 'audi',
  'kick sauber': 'audi',
  sauber: 'audi',
  'aston martin': 'aston_martin',
  cadillac: 'cadillac',
};

async function json(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': 'f1-fantasy-pomocnik', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} za ${url}`);
  return res.json();
}

const supabase = (path, init = {}) =>
  json(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      // Stari service_role ključ (JWT) ide i u Authorization; novi sb_secret_ ključ samo u apikey.
      ...(SERVICE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${SERVICE_KEY}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

async function main() {
  if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
    throw new Error('Nedostaju SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY (ili pokreni s DRY_RUN=1).');
  }

  // Trenutna runda u službenoj igri i cijene za nju.
  const limits = await json(`${FANTASY}/limits/constraints.json`);
  const gameday = limits.Data.Value.GamedayId;
  const feed = (await json(`${FANTASY}/drivers/${gameday}_en.json`)).Data.Value;

  // Kratica vozača (VER, NOR…) → driverId i sezona iz Jolpica API-ja.
  const drivers = (await json(`${JOLPICA}/current/drivers.json?limit=100`)).MRData.DriverTable;
  const season = Number(drivers.season);
  const byCode = new Map(drivers.Drivers.filter((d) => d.code).map((d) => [d.code, d.driverId]));

  const wanted = [];
  const unmapped = [];
  for (const p of feed) {
    if (p.PositionName === 'CONSTRUCTOR') {
      const id = TEAMS[String(p.FUllName).toLowerCase()];
      if (id) wanted.push({ kind: 'constructor', asset_id: id, price: Number(p.Value) });
      else unmapped.push(p.FUllName);
    } else if (String(p.IsActive) === '1') {
      // Neaktivni (npr. stari unos vozača koji je promijenio tim) se preskaču.
      const id = byCode.get(p.DriverTLA);
      if (id) wanted.push({ kind: 'driver', asset_id: id, price: Number(p.Value) });
      else unmapped.push(`${p.FUllName} (${p.DriverTLA})`);
    }
  }
  if (wanted.length < 15) throw new Error(`Premalo cijena (${wanted.length}); feed je možda promijenio oblik.`);

  console.log(`Sezona ${season}, službena runda ${gameday}: ${wanted.length} cijena.`);
  if (unmapped.length) console.log(`Nije spojeno (preskočeno): ${unmapped.join(', ')}`);

  if (DRY_RUN) {
    for (const w of wanted) console.log(`  ${w.kind.padEnd(11)} ${w.asset_id.padEnd(16)} ${w.price.toFixed(1)}M`);
    return;
  }

  // Upisuju se samo promijenjene cijene, da povijest cijena ostane čista.
  const current = await supabase(`prices?season=eq.${season}&select=kind,asset_id,price`);
  const old = new Map(current.map((r) => [`${r.kind}:${r.asset_id}`, Number(r.price)]));
  const changed = wanted.filter((w) => old.get(`${w.kind}:${w.asset_id}`) !== w.price);
  if (!changed.length) return console.log('Nema promjena.');

  await supabase('prices?on_conflict=season,kind,asset_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(changed.map((c) => ({ season, ...c, updated_at: new Date().toISOString() }))),
  }).catch((e) => {
    // return=minimal vraća prazno tijelo; json() tada baca grešku iako je upis uspio.
    if (!/Unexpected end of JSON/.test(String(e))) throw e;
  });
  for (const c of changed) {
    const before = old.get(`${c.kind}:${c.asset_id}`);
    console.log(`  ${c.asset_id}: ${before != null ? before.toFixed(1) : 'zadano'} → ${c.price.toFixed(1)}M`);
  }
  console.log(`Upisano ${changed.length} promjena.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
