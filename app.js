/* AI-Visibility Audit — front end. Backend: a worker polls the request queue and publishes data/<slug>.status.json + data/<slug>.json. */
const WEBHOOK = "https://discord.com/api/webhooks/1561639613918093353/SC5sPYMw8-w10i5vRIK_7wkHpDGlZa1irtkIvDv4hGYIG0ssbLzbVizrboYT-gKf8wmo";
const BANDS = {"Invisible": ["Publish a personal website at yourname.com with an About page, a clear one-line bio, and a project/credential list \u2014 this is the single biggest anchor for AI answers.", "Complete a LinkedIn profile: headline, About, experience with outcomes, featured links. Use your full real name consistently everywhere.", "Start a content cadence: one substantive post or article per week under your own name for 90 days.", "Get any third-party mention: guest post, alumni/org feature, local news, or a podcast guest slot."], "Thin": ["Turn the site into a hub: case studies, a press/media page, and schema.org Person markup so models can tie your profiles together.", "Tighten LinkedIn and make sure every profile (X, YouTube, GitHub, site) links to the others with identical name and bio.", "Raise content cadence to 2\u20133 indexed pieces a week; long-form pieces and transcripts get cited more than short posts.", "Pitch 3\u20135 podcasts and one local/trade press story per quarter; each gives an independent source domain."], "Visible": ["Close the gaps between models: the weakest model's missing facts show which pages are unindexed or inconsistent.", "Add press and podcast appearances to a dedicated page with transcripts and dates so claims are verifiable.", "Keep cadence steady and publish proof (numbers, named clients, outcomes) rather than adjectives.", "Correct any inaccuracies at the source page, not by arguing with the AI."], "Undeniable": ["Maintain: audit quarterly, refresh the bio and facts page, and watch for same-name collisions.", "Expand source diversity \u2014 more independent domains means more resilient answers.", "Fix any remaining factual errors at the source and keep press/podcast pages current."]};
const MODELS = ["GPT","Claude","Gemini","Grok"];
const $ = s => document.querySelector(s);
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const toast = m => { const t=$("#toast"); t.textContent=m; t.classList.add("on"); setTimeout(()=>t.classList.remove("on"),2200); };
const bust = () => "?t=" + Date.now();
let poller=null, logLines=0, curSlug=null, curName=null;

async function getJSON(path){ const r = await fetch(path + bust(), {cache:"no-store"}); if(!r.ok) throw new Error(r.status); return r.json(); }
function log(msg, cls){ const l=$("#log"); const d=document.createElement("div"); d.className=cls||""; d.textContent=`${new Date().toLocaleTimeString([], {hour12:false})}  ${msg}`; l.appendChild(d); l.scrollTop=l.scrollHeight; if(++logLines>80){ l.removeChild(l.firstChild); } }
function gauge(v){ const off = 703 - (703 * Math.max(0,Math.min(100,v))/100); $("#gbar").style.strokeDashoffset = off; const n=$("#gnum"); const start=parseFloat(n.textContent)||0; const t0=performance.now(); (function step(t){ const p=Math.min(1,(t-t0)/1100); const e=1-Math.pow(1-p,3); n.textContent=(start+(v-start)*e).toFixed(1); if(p<1) requestAnimationFrame(step);} )(t0); }
function setVerdict(v){ const el=$("#verdict"); el.className="verdict v-"+(v||"Running"); el.textContent = v||"Running"; }

function modelCard(m, s){
  s = s || {};
  const st = s.state || "waiting";
  const cls = st==="done"?"done":(st==="failed"?"failed":(st==="skipped"?"skipped":(st==="waiting"?"":"active")));
  const pd = s.prompts_done||0, pt = s.prompts_total||3;
  const pct = st==="done"?100:(st==="grading"?90:(pd/pt*75));
  const stLabel = {waiting:"queued", querying:`querying · ${pd}/${pt} prompts`, grading:"grading answers", done:"complete", failed:"no answer", skipped:"offline"}[st]||st;
  const score = s.scores?.Overall;
  const rec = s.recommendation ? `<span class="rec ${s.recommendation}">${s.recommendation==="yes"?"would shortlist":s.recommendation==="maybe"?"maybe":"would not shortlist"}</span>` : "";
  return `<div class="mcard ${cls}" id="mc-${m}">
    <div class="mn"><span>${m}</span>${rec}</div>
    <div class="mid">${esc(s.model||"")}</div>
    <div class="st">${stLabel}</div>
    <div class="big">${score!=null?score.toFixed(1):(st==="skipped"||st==="failed"?"—":"<span style='color:var(--mut)'>…</span>")}</div>
    <div class="sub">${s.recognition!=null?`recognition ${s.recognition} · `:""}${s.domains_seen!=null?`${s.domains_seen} source domains`:""}</div>
    <div class="prog"><i class="${cls==="active"?"pulse":""}" style="width:${pct}%"></i></div>
  </div>`;
}
function renderCards(models){ $("#mgrid").innerHTML = MODELS.map(m=>modelCard(m, models?.[m])).join(""); }

function showRun(name, ctx){ $("#home").classList.add("hidden"); $("#run").classList.remove("hidden"); $("#rname").textContent=name; $("#rctx").textContent=ctx||""; $("#report").classList.add("hidden"); $("#notice").classList.add("hidden"); $("#warns").innerHTML=""; $("#log").innerHTML=""; logLines=0; $("#gnum").textContent="—"; $("#gbar").style.strokeDashoffset=703; $("#scan").classList.add("on"); setVerdict(null); renderCards({}); window.scrollTo({top:0,behavior:"smooth"}); }
function notice(msg, err){ const n=$("#notice"); n.textContent=msg; n.className="note"+(err?" err":""); n.classList.remove("hidden"); }

let lastSig = "";
function applyStatus(s){
  const sig = JSON.stringify(s); if(sig===lastSig) return; lastSig=sig;
  if(s.state==="queued"){ setVerdict(null); $("#verdict").textContent="Queued"; log("request accepted — waiting for a worker","c"); }
  if(s.state==="running"){ $("#verdict").textContent="Running"; renderCards(s.models);
    for(const m of MODELS){ const ms=s.models?.[m]; if(!ms) continue; const key=m+":"+ms.state+":"+(ms.prompts_done||0);
      if(!applyStatus.seen) applyStatus.seen=new Set(); if(applyStatus.seen.has(key)) continue; applyStatus.seen.add(key);
      if(ms.state==="querying") log(`${m}: ${ms.prompts_done||0}/${ms.prompts_total||3} prompts${ms.domains_seen!=null?` · ${ms.domains_seen} source domains`:""}`);
      if(ms.state==="grading") log(`${m}: answers in — grading`,"c");
      if(ms.state==="done") log(`${m}: ${ms.scores?.Overall?.toFixed(1)} · recognition ${ms.recognition} · ${ms.recommendation}`,"ok");
      if(ms.state==="failed") log(`${m}: no usable answer`,"bad");
      if(ms.state==="skipped") log(`${m}: offline (${ms.reason||"no key"})`);
    }
    const done = MODELS.map(m=>s.models?.[m]?.scores?.Overall).filter(v=>v!=null); if(done.length){ gauge(done.reduce((a,b)=>a+b,0)/done.length); }
  }
  if(s.state==="error"){ $("#scan").classList.remove("on"); setVerdict("Unscored"); notice(s.error||"The audit could not run.", true); log(s.error||"error","bad"); stopPoll(); }
}

function stopPoll(){ if(poller){ clearInterval(poller); poller=null; } }

async function renderReport(data){
  const a = data.audits[0]; curName=a.name;
  $("#scan").classList.remove("on"); stopPoll();
  renderCards(Object.fromEntries(MODELS.map(m=>{ const r=a.models[m]; if(!r) return [m,{state:"skipped",reason:"no key"}]; if(!r.worked) return [m,{state:"failed",model:r.model}]; return [m,{state:"done",model:r.model,scores:r.scores,recognition:r.grade?.recognition,recommendation:r.grade?.recommendation,domains_seen:Object.keys(r.domains||{}).length}]; })));
  if(a.footprint!=null) gauge(a.footprint); setVerdict(a.verdict);
  $("#glab").textContent = `Footprint score · ${a.scored_models} models · ${a.date}`;
  const warns=[]; const wrong = MODELS.filter(m=>a.models[m]?.grade?.wrong_person);
  if(wrong.length) warns.push(`⚠ ${wrong.join(", ")} described a different person with this name`);
  if(!a.has_facts) warns.push("accuracy not scored — no facts file supplied");
  $("#warns").innerHTML = warns.map(w=>`<div class="warn">${esc(w)}</div>`).join("");
  log(`final: ${a.footprint} · ${a.verdict}`,"ok");
  // bars
  const dims=["Recognition","Depth","Sources","Recommendation","Accuracy"]; const worked=MODELS.filter(m=>a.models[m]?.worked);
  $("#bars").innerHTML = dims.map(d=>{ const vals=worked.map(m=>a.models[m].scores?.[d]).filter(v=>v!=null); if(!vals.length) return `<div class="bar-row"><span>${d}</span><div class="t"></div><span class="v">n/a</span></div>`; const v=vals.reduce((x,y)=>x+y,0)/vals.length; return `<div class="bar-row"><span>${d}</span><div class="t"><i data-w="${v}"></i></div><span class="v">${v.toFixed(0)}</span></div>`; }).join("");
  requestAnimationFrame(()=>document.querySelectorAll("#bars i").forEach(i=>i.style.width=i.dataset.w+"%"));
  // tabs + answers
  $("#tabs").innerHTML = worked.map((m,i)=>`<button class="tab ${i?"":"on"}" data-m="${m}">${m} · ${a.models[m].scores.Overall.toFixed(1)}</button>`).join("");
  const showAns = m => { const r=a.models[m]; const g=r.grade||{}; $("#answers").innerHTML = `<div class="note" style="margin-bottom:12px">${esc(g.recommendation_reason||"")}</div>` + r.answers.map((an,i)=>`<details ${i===0?"open":""}><summary><span>Prompt ${i+1}: ${esc((an.prompt||"").slice(0,90))}…</span><span>${an.mode||""} · ${an.secs||"?"}s</span></summary><div class="md">${DOMPurify.sanitize(marked.parse(an.text||""))}</div></details>`).join(""); document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.dataset.m===m)); };
  document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>showAns(t.dataset.m)); if(worked.length) showAns(worked[0]);
  // claims
  const rows=[]; for(const m of worked){ for(const c of (a.models[m].grade?.claims||[])) rows.push(`<tr><td>${m}</td><td>${esc(c.claim)}</td><td>${c.source?`<a style="color:var(--cyan)" href="${esc(/^https?:/.test(c.source)?c.source:"https://"+c.source)}" target="_blank" rel="noopener">${esc(c.source)}</a>`:"—"}</td><td><span class="sc ${esc(c.status||"")}">${esc(c.status||"")}</span></td></tr>`); }
  $("#claims").innerHTML = `<thead><tr><th>Model</th><th>Claim</th><th>Source</th><th>Status</th></tr></thead><tbody>${rows.join("")||"<tr><td colspan=4>No claims extracted.</td></tr>"}</tbody>`;
  // domains
  const dom={}; for(const m of worked) for(const [d,n] of Object.entries(a.models[m].domains||{})) dom[d]=(dom[d]||0)+n;
  $("#doms").innerHTML = Object.entries(dom).sort((x,y)=>y[1]-x[1]).slice(0,60).map(([d,n])=>`<span class="dom" style="font-size:${Math.min(15,11+Math.log2(n))}px">${esc(d)}<b>${n}</b></span>`).join("") || "<span class='hint'>No sources cited.</span>";
  $("#move").innerHTML = (BANDS[a.verdict]||[]).map(x=>`<li>${esc(x)}</li>`).join("");
  $("#report").classList.remove("hidden");
  const age = (Date.now()-new Date(a.date).getTime())/864e5; $("#rerun").classList.toggle("hidden", age<7);
  history.replaceState(null,"",`?name=${curSlug}`);
}

async function open(slug){
  curSlug=slug;
  try { const data = await getJSON(`data/${slug}.json`); showRun(data.audits[0].name, data.audits[0].context); log("cached audit found","c"); await renderReport(data); return true; } catch(e){ return false; }
}

function startPoll(slug, name, ctx){
  curSlug=slug; showRun(name, ctx); log("dispatching to the models…","c"); applyStatus.seen=new Set(); lastSig="";
  const t0=Date.now(); let n404=0;
  const tick = async () => {
    try { const s = await getJSON(`data/${slug}.status.json`); applyStatus(s);
      if(s.state==="done"){ try{ const d=await getJSON(`data/${slug}.json`); await renderReport(d); }catch(e){ /* json may lag status by one deploy */ } }
    } catch(e){ n404++; if(n404%6===0) log("still dispatching — publishing can take a minute"); }
    if(Date.now()-t0 > 8*60e3){ stopPoll(); $("#scan").classList.remove("on"); notice("This is taking longer than usual. Leave the tab open or come back to this link in a few minutes — the result will appear here when it lands.", false); }
  };
  tick(); poller=setInterval(tick, 8000);
}

async function submit(name, ctx){
  const slug=slugify(name); if(slug.length<3){ toast("Enter a full name"); return; }
  $("#go").disabled=true;
  // cached?
  const had = await open(slug); if(had){ $("#go").disabled=false; return; }
  try {
    const body = {content: "AUDIT " + JSON.stringify({name, context: ctx||"", rid: Math.random().toString(36).slice(2,10)})};
    const r = await fetch(WEBHOOK, {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body)});
    if(!r.ok && r.status!==204) throw new Error("queue "+r.status);
    startPoll(slug, name, ctx);
  } catch(e){ toast("Could not queue the audit — try again"); }
  $("#go").disabled=false;
}

async function loadRecent(){
  try { const idx = await getJSON("data/index.json"); $("#recentList").innerHTML = (idx.audits||[]).slice(0,12).map(a=>`<a href="?name=${a.slug}"><span class="sc" style="float:right;color:var(--cyan)">${a.footprint??"—"}</span><div class="n">${esc(a.name)}</div><div class="s">${esc(a.verdict)} · ${esc(a.date)}</div></a>`).join("") || "<div class='hint'>No audits yet.</div>"; } catch(e){ $("#recentList").innerHTML="<div class='hint'>Recent audits unavailable.</div>"; }
}

$("#form").addEventListener("submit", e=>{ e.preventDefault(); submit($("#name").value.trim(), $("#ctx").value.trim()); });
$("#share").onclick = () => { navigator.clipboard.writeText(location.origin+location.pathname+`?name=${curSlug}`).then(()=>toast("Link copied")); };
$("#print").onclick = () => { document.querySelectorAll("#answers details").forEach(d=>d.open=true); window.print(); };
$("#rerun").onclick = async () => { $("#rerun").classList.add("hidden"); const body={content:"AUDIT "+JSON.stringify({name:curName,context:$("#rctx").textContent,rid:Math.random().toString(36).slice(2,10),force:true})}; await fetch(WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); startPoll(curSlug, curName, $("#rctx").textContent); };

(async () => {
  loadRecent();
  const q = new URLSearchParams(location.search).get("name");
  if(q){ const slug=slugify(q); const ok = await open(slug); if(!ok){ try{ const s=await getJSON(`data/${slug}.status.json`); startPoll(slug, s.name||q, s.context||""); }catch(e){ $("#name").value=q; toast("No audit yet for that name — run one"); } } }
})();
