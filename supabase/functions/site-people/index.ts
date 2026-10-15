import postgres from 'npm:postgres@3.4.4';
// site-people v5 (D72, D73; leadtopup site_check question=people). D111: HTTP k= from vault site_people_key.
// Project azpapwtnrbzywlnxxecz only. Do not deploy until Josh says. Never put the key in git.
// v5: capture EVERY named person. Bigger people-page budget, second hop crawl
// from about/people pages, no 12 person cap, org_name + org_type per site.
// fetch / extract / ask claim rows so the service can fan calls out. Counts only.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const HOME_CHARS = 6000;
const PAGE_CHARS = 20000;
const BODY_CHARS = 120000;
const MAX_PAGES = 8;
const MAX_HOP2 = 4;
const MAX_PEOPLE = 80;
const PEOPLE_RE = /team|leadership|leaders|staff|management|our-people|people|who-we-are|meet|founder|owner|executive|board|pastor|elder|deacon|minister|clergy|directory|employees|principals|partners|our-firm|about|our-story|ourstory|story|history|contact/i;
const STRONG_RE = /team|leadership|leaders|staff|management|our-people|people|who-we-are|meet|founder|owner|executive|board|pastor|elder|deacon|minister|clergy|directory|employees|principals|partners/i;
const ok = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function backoffMs(attempt: number) {
  const exp = Math.min(16000, 400 * 2 ** attempt);
  return exp + Math.floor(Math.random() * exp * 0.4);
}
function clean(html: string) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<(br|p|div|li|h[1-6]|tr|section|article)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#?\w+;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return `${title}\n${body}`.replace(/\u0000/g, '').replace(/[\uD800-\uDFFF]/g, '');
}
function structured(html: string): string[] {
  const out: string[] = [];
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    const t = String(v['@type'] ?? '').toLowerCase();
    if (t.includes('person') && typeof v.name === 'string') out.push(`${v.name.trim()} — ${typeof v.jobTitle === 'string' ? v.jobTitle.trim() : 'no title given'}`);
    for (const k of ['founder', 'founders', 'owner', 'employee', 'employees', 'member']) for (const p of Array.isArray(v[k]) ? v[k] : v[k] ? [v[k]] : []) {
      if (typeof p === 'string') out.push(`${p.trim()} — ${k}`);
      else if (p && typeof p.name === 'string') out.push(`${p.name.trim()} — ${typeof p.jobTitle === 'string' ? p.jobTitle.trim() : k}`);
    }
    for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch { /* broken json-ld */ } }
  return [...new Set(out)].slice(0, 60);
}
async function get(url: string, ms = 10000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: c.signal }); const h = await r.text(); return { status: r.status, url: r.url, html: h.slice(0, 1500000) }; }
  finally { clearTimeout(t); }
}
function links(html: string, base: URL, seen: Set<string>) {
  const cands: Array<{ u: URL; score: number }> = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let u: URL; try { u = new URL(m[1], base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (seen.has(path) || /\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|mp3)$/i.test(path)) continue;
    const hay = `${path} ${m[2].replace(/<[^>]+>/g, ' ')}`;
    if (!PEOPLE_RE.test(hay)) continue;
    seen.add(path);
    const score = STRONG_RE.test(hay) ? 3 : /about|our-story|ourstory|story|history/i.test(hay) ? 2 : 1;
    cands.push({ u, score });
  }
  return cands.sort((a, b) => b.score - a.score);
}
async function one(domain: string) {
  let home: any = null; let err: string | null = null;
  for (const u of [`https://${domain}`, `https://www.${domain}`, `http://${domain}`]) {
    try { home = await get(u); if (home.status < 400 && home.html.length > 200) break; } catch (e) { err = String(e).slice(0, 120); home = null; }
  }
  if (!home) return { domain, http_status: 0, final_url: null, pages: 0, chars: 0, body: null, error: err ?? 'fetch failed' };
  let text = 'HOMEPAGE: ' + clean(home.html).slice(0, HOME_CHARS); let pages = 1; const htmls = [home.html];
  if (home.status < 400) {
    const base = new URL(home.url);
    const seen = new Set<string>([base.pathname.replace(/\/$/, '') || '/']);
    const pick = links(home.html, base, seen).slice(0, MAX_PAGES);
    const fetchAll = (list: Array<{ u: URL }>) => Promise.all(list.map(async c => { try { const p = await get(c.u.toString(), 8000); return p.status < 400 ? { path: c.u.pathname, html: p.html } : null; } catch { return null; } }));
    const subs = (await fetchAll(pick)).filter(Boolean) as Array<{ path: string; html: string }>;
    // second hop: staff pages often hang off About, not the homepage nav
    const hop2: Array<{ u: URL; score: number }> = [];
    for (const s of subs) for (const c of links(s.html, base, seen)) if (c.score === 3) hop2.push(c);
    const subs2 = (await fetchAll(hop2.slice(0, MAX_HOP2))).filter(Boolean) as Array<{ path: string; html: string }>;
    for (const s of [...subs, ...subs2]) { text += `\nPAGE ${s.path}: ` + clean(s.html).slice(0, PAGE_CHARS); pages++; htmls.push(s.html); }
  }
  const st = htmls.flatMap(structured);
  if (st.length) text += '\nSTRUCTURED (schema.org people on the pages):\n' + [...new Set(st)].slice(0, 60).join('\n');
  return { domain, http_status: home.status, final_url: home.url, pages, chars: text.length, body: text.slice(0, BODY_CHARS), error: home.status >= 400 ? `http ${home.status}` : null };
}
async function vault(sql: any, name: string) { const [r] = await sql`select decrypted_secret s from vault.decrypted_secrets where name = ${name}`; return r?.s as string; }
const ORG_TYPES = ['church', 'school', 'nonprofit', 'association', 'government', 'property_company', 'business', 'directory_or_unrelated', 'unknown'];
const PERSON_SCHEMA = { type: 'OBJECT', properties: { org_name: { type: 'STRING' }, org_type: { type: 'STRING', enum: ORG_TYPES }, people: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, title: { type: 'STRING' }, evidence: { type: 'STRING' }, page: { type: 'STRING' } }, required: ['name', 'title', 'evidence'] } } }, required: ['org_name', 'org_type', 'people'] };
async function gemini(key: string, model: string, dom: string, txt: string) {
  const prompt = `From this website text:
1. org_name: the organization's real name as the site writes it.
2. org_type: one of ${ORG_TYPES.join(', ')}. church = a congregation or ministry with services. school = any school or academy, even church run. property_company = owns, manages or develops real estate. directory_or_unrelated = a directory, listing site, or a site that is clearly not this organization's own.
3. people: list EVERY person the site presents as part of the organization: owners, founders, partners, executives, pastors, clergy, elders, deacons, board members, managers, staff, administrators. Do not stop early and do not pick only the senior ones; if a staff page lists 40 people, return all 40. For each give the name as written, the title or role the site gives them (or "no title given"), a short quote under 160 characters showing where the site says so, and the page label it came from (HOMEPAGE, PAGE /path, or STRUCTURED). Only names that appear in the text; never guess or invent a person or a title. Skip customers, testimonial authors, review writers, article bylines from other companies, and words that are not a person.

Domain: ${dom}
Website text:
${txt}`;
  let last = 'gemini failed';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 16000, responseMimeType: 'application/json', responseSchema: PERSON_SCHEMA } }) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) { last = `gemini ${r.status}`; await sleep(backoffMs(i)); continue; }
    if (!r.ok) throw new Error(`gemini ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const t = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '{"people":[]}';
    const o = JSON.parse(t);
    const people = (Array.isArray(o.people) ? o.people : []).map((p: any) => ({ name: String(p.name ?? '').replace(/\s+/g, ' ').trim(), title: String(p.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null, evidence: String(p.evidence ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null, page: String(p.page ?? '').trim().slice(0, 120) || null }))
      .filter((p: any) => p.name.length >= 2 && p.name.length <= 60 && !/@|http|\d{3}/.test(p.name)).slice(0, MAX_PEOPLE);
    return { people, org_name: String(o.org_name ?? '').trim().slice(0, 160) || null, org_type: ORG_TYPES.includes(o.org_type) ? o.org_type : 'unknown', in_tok: j.usageMetadata?.promptTokenCount ?? null, out_tok: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0) };
  }
  throw new Error(last);
}
async function jevPick(key: string, model: string, lookingFor: string, dom: string, txt: string, people: Array<{ k: string; n: string; t: string | null; e: string | null }>) {
  const criteria: Record<string, string> = {};
  people.forEach((p, i) => { criteria[`p${i + 1}`] = `${p.n}, ${p.t ?? 'no title given'}.${p.e ? ` Site says: "${p.e}"` : ''}`; });
  criteria.nobody_listed = `None of the people listed is ${lookingFor}, or the website does not say who is.`;
  const body = { model, state: { domain: dom, looking_for: lookingFor, website_text: txt.slice(0, 16000) }, questions: { who: { type: 'choice', instructions: `We are looking for ${lookingFor} at this company. Going by the website text, which of these people is that? Pick nobody_listed if none of them is, or the site does not say.`, criteria } } };
  for (let i = 0; i < 5; i++) {
    if (i) await sleep(backoffMs(i - 1));
    const r = await fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) continue;
    if (!r.ok) throw new Error(`jev ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const a = j.answers ?? {};
    const choice = typeof a.who?.choice === 'string' ? a.who.choice : 'nobody_listed';
    const idx = /^p(\d+)$/.test(choice) ? Number(choice.slice(1)) - 1 : -1;
    const person_key = idx >= 0 && people[idx] ? people[idx].k : null;
    const prob = Number(a.who?.probabilities?.[choice] ?? 0);
    return { person_key, prob, answers: { ...a, options: Object.fromEntries(people.map((p, i) => [`p${i + 1}`, p.k])) }, in_tok: j.usage?.input_tokens ?? null, out_tok: j.usage?.output_tokens ?? null, cost: j.usage?.cost ?? null };
  }
  throw new Error('jev retries exhausted');
}
class HostCap {
  private readonly n = new Map<string, number>();
  constructor(private readonly max: number) {}
  host(d: string) { return d.toLowerCase().replace(/^www\./, ''); }
  async run<T>(d: string, fn: () => Promise<T>): Promise<T> {
    const h = this.host(d);
    while ((this.n.get(h) ?? 0) >= this.max) await sleep(40);
    this.n.set(h, (this.n.get(h) ?? 0) + 1);
    try { return await fn(); } finally {
      const left = (this.n.get(h) ?? 1) - 1;
      if (left <= 0) this.n.delete(h); else this.n.set(h, left);
    }
  }
}
Deno.serve(async (req) => {
  const u = new URL(req.url);
  const mode = u.searchParams.get('mode');
  const batch = u.searchParams.get('batch');
  if (!batch) return ok({ error: 'batch is required' }, 400);
  const n = Number(u.searchParams.get('n') ?? 60);
  const w = Math.min(Number(u.searchParams.get('w') ?? 8), 60);
  const hostMax = Math.min(Math.max(Number(u.searchParams.get('host') ?? 2), 1), 4);
  const t0 = Date.now();
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  try {
    const gate = await vault(sql, 'site_people_key');
    if (!gate) return ok({ error: 'site_people_key missing from vault' }, 500);
    if (u.searchParams.get('k') !== gate) return new Response('forbidden', { status: 403 });
    if (mode === 'fetch') {
      const rows = await sql`update topup.site_people_text s set http_status = -1, fetched_at = now() where s.domain in (select domain from topup.site_people_text where batch = ${batch} and (http_status is null or (http_status = -1 and fetched_at < now() - interval '10 minutes')) limit ${n} for update skip locked) returning s.domain`;
      let done = 0, okc = 0;
      const q = rows.map((r: any) => r.domain);
      const results: any[] = [];
      const hosts = new HostCap(hostMax);
      async function worker() { while (q.length && Date.now() - t0 < 110000) { const d = q.shift()!; const x = await hosts.run(d, () => one(d)); done++; if (x.body && (x.http_status ?? 0) < 400) okc++; results.push(x); } }
      await Promise.all(Array.from({ length: w }, worker));
      for (const x of results) await sql`update topup.site_people_text set http_status = ${x.http_status}, final_url = ${x.final_url}, pages = ${x.pages}, chars = ${x.chars}, body = ${x.body}, error = ${x.error}, fetched_at = now() where domain = ${x.domain}`;
      if (q.length) await sql`update topup.site_people_text set http_status = null where domain = any(${q}) and http_status = -1`;
      const [left] = await sql`select count(*)::int c from topup.site_people_text where batch = ${batch} and (http_status is null or http_status = -1)`;
      return ok({ processed: done, ok: okc, released: q.length, remaining: left.c });
    }
    if (mode === 'extract') {
      const spec = u.searchParams.get('model') ?? 'gemini:gemini-3.1-flash-lite';
      if (!spec.startsWith('gemini:')) return ok({ error: 'extract takes model=gemini:<name>' }, 400);
      const model = spec.slice('gemini:'.length);
      const key = await vault(sql, 'gemini_api_key');
      const rows = await sql`
        with claim as (
          select t.domain, t.body
            from topup.site_people_text t
           where t.batch = ${batch}
             and t.http_status between 200 and 399
             and coalesce(t.chars, 0) > 300
             and not exists (select 1 from topup.site_extractions e where e.domain = t.domain and e.error is null)
             and not exists (select 1 from topup.site_extractions e where e.domain = t.domain and e.error = 'in_progress' and e.extracted_at > now() - interval '3 minutes')
           order by t.domain
           limit ${n}
           for update of t skip locked
        ), ins as (
          insert into topup.site_extractions (domain, model, people, error, extracted_at)
          select domain, ${spec}, 0, 'in_progress', now() from claim
          on conflict (domain) do update
            set model = excluded.model, error = 'in_progress', extracted_at = now()
            where topup.site_extractions.error is not null
          returning domain
        )
        select c.domain, c.body from claim c join ins i using (domain)`;
      const q = [...rows]; let done = 0, errs = 0, lastErr: string | null = null, found = 0;
      async function worker() { while (q.length && Date.now() - t0 < 125000) { const r: any = q.shift(); let x: any; try { x = await gemini(key, model, r.domain, r.body); x.error = null; } catch (e) { errs++; lastErr = String(e).slice(0, 250); x = { people: [], org_name: null, org_type: null, in_tok: null, out_tok: null, error: lastErr }; }
        done++;
        for (const p of x.people) { found++; await sql`insert into topup.site_people (domain, person_key, full_name, title, evidence, page_url, model) values (${r.domain}, md5(lower(${p.name})), ${p.name}, ${p.title}, ${p.evidence}, ${p.page}, ${spec}) on conflict (domain, person_key) do update set title = coalesce(excluded.title, topup.site_people.title), evidence = coalesce(excluded.evidence, topup.site_people.evidence), page_url = coalesce(excluded.page_url, topup.site_people.page_url), model = excluded.model, extracted_at = now()`; }
        await sql`insert into topup.site_extractions (domain, model, people, in_tok, out_tok, cost, error, org_name, org_type, extracted_at) values (${r.domain}, ${spec}, ${x.people.length}, ${x.in_tok}, ${x.out_tok}, null, ${x.error}, ${x.org_name}, ${x.org_type}, now()) on conflict (domain) do update set model = excluded.model, people = excluded.people, in_tok = excluded.in_tok, out_tok = excluded.out_tok, error = excluded.error, org_name = excluded.org_name, org_type = excluded.org_type, extracted_at = now()`; } }
      await Promise.all(Array.from({ length: w }, worker));
      if (q.length) await sql`update topup.site_extractions set error = 'released' where domain = any(${q.map((r: any) => r.domain)}) and error = 'in_progress'`;
      const [left] = await sql`select count(*)::int c from topup.site_people_text t where t.batch = ${batch} and t.http_status between 200 and 399 and coalesce(t.chars, 0) > 300 and not exists (select 1 from topup.site_extractions e where e.domain = t.domain and e.error is null)`;
      return ok({ model: spec, processed: done, errors: errs, last_error: lastErr, people: found, remaining: left.c });
    }
    if (mode === 'ask') {
      const lookingFor = (u.searchParams.get('looking_for') ?? '').replace(/\s+/g, ' ').trim();
      if (!lookingFor) return ok({ error: 'looking_for is required' }, 400);
      const spec = u.searchParams.get('model') ?? 'jev:typesafe/jev-1.13';
      if (!spec.startsWith('jev:')) return ok({ error: 'ask takes model=jev:<openrouter id>' }, 400);
      const model = spec.slice('jev:'.length);
      const key = await vault(sql, 'openrouter_api_key');
      const onlyPending = u.searchParams.get('only') === 'sql_unpicked';
      const rows = await sql`
        with claim as (
          select t.domain, t.body, e.people, coalesce((select json_agg(json_build_object('k', p.person_key, 'n', p.full_name, 't', p.title, 'e', p.evidence) order by p.extracted_at, p.person_key) from topup.site_people p where p.domain = t.domain), '[]'::json) as people_json
            from topup.site_people_text t
            join topup.site_extractions e on e.domain = t.domain and e.error is null
           where t.batch = ${batch}
             and (${!onlyPending} or not exists (select 1 from topup.site_dm_pick d where d.domain = t.domain and d.pick_source = 'sql'))
             and not exists (select 1 from topup.site_answers a where a.domain = t.domain and a.question_key = md5(lower(${lookingFor})) and a.error is null)
             and not exists (select 1 from topup.site_answers a where a.domain = t.domain and a.question_key = md5(lower(${lookingFor})) and a.error = 'in_progress' and a.answered_at > now() - interval '3 minutes')
           order by t.domain
           limit ${n}
           for update of t skip locked
        ), ins as (
          insert into topup.site_answers (domain, question_key, looking_for, error, answered_at)
          select domain, md5(lower(${lookingFor})), ${lookingFor}, 'in_progress', now() from claim
          on conflict (domain, question_key) do update
            set looking_for = excluded.looking_for, error = 'in_progress', answered_at = now()
            where topup.site_answers.error is not null
          returning domain
        )
        select c.domain, c.body, c.people, c.people_json from claim c join ins i using (domain)`;
      const q = [...rows]; let done = 0, errs = 0, lastErr: string | null = null, found = 0, nobody = 0;
      async function worker() { while (q.length && Date.now() - t0 < 125000) { const r: any = q.shift(); const people = (Array.isArray(r.people_json) ? r.people_json : []).slice(0, MAX_PEOPLE); let x: any;
        if (!people.length) x = { person_key: null, prob: null, answers: null, in_tok: null, out_tok: null, cost: null, error: null, model: 'none' };
        else { try { x = await jevPick(key, model, lookingFor, r.domain, r.body, people); x.error = null; x.model = spec; } catch (e) { errs++; lastErr = String(e).slice(0, 250); x = { person_key: null, prob: null, answers: null, in_tok: null, out_tok: null, cost: null, error: lastErr, model: spec }; } }
        done++; if (x.person_key) found++; else if (!x.error) nobody++;
        await sql`insert into topup.site_answers (domain, question_key, looking_for, person_key, prob, model, answers, in_tok, out_tok, cost, error, answered_at) values (${r.domain}, md5(lower(${lookingFor})), ${lookingFor}, ${x.person_key}, ${x.prob}, ${x.model}, ${x.answers ? sql.json(x.answers) : null}, ${x.in_tok}, ${x.out_tok}, ${x.cost}, ${x.error}, now()) on conflict (domain, question_key) do update set looking_for = excluded.looking_for, person_key = excluded.person_key, prob = excluded.prob, model = excluded.model, answers = excluded.answers, in_tok = excluded.in_tok, out_tok = excluded.out_tok, cost = excluded.cost, error = excluded.error, answered_at = now()`; } }
      await Promise.all(Array.from({ length: w }, worker));
      if (q.length) await sql`update topup.site_answers set error = 'released' where domain = any(${q.map((r: any) => r.domain)}) and question_key = md5(lower(${lookingFor})) and error = 'in_progress'`;
      const [left] = await sql`select count(*)::int c from topup.site_people_text t join topup.site_extractions e on e.domain = t.domain and e.error is null where t.batch = ${batch} and not exists (select 1 from topup.site_answers a where a.domain = t.domain and a.question_key = md5(lower(${lookingFor})) and a.error is null)`;
      return ok({ model: spec, looking_for: lookingFor, processed: done, errors: errs, last_error: lastErr, found, nobody_listed: nobody, remaining: left.c });
    }
    return ok({ error: 'unknown mode' }, 400);
  } catch (e) { return ok({ ok: false, error: String(e).slice(0, 300) }, 500); }
  finally { await sql.end({ timeout: 2 }).catch(() => {}); }
});
