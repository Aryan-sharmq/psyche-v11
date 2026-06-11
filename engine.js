// PRISM Analysis Engine v2 — Claude primary, discriminative rule-based fallback.
// v2 fixes: absolute (not relative) scoring, frequency-weighted lexicon,
// stylometric signals, so different texts produce genuinely different profiles.

const crypto = require('crypto');

const ENGINE_VERSION = 3; // bump this whenever analysis logic changes — invalidates the dedupe cache

const LEX = {
  P: {
    'Pattern Seeker':      [['pattern',3],['system',2],['structure',2],['framework',2],['underlying',3],['connect',2],['big picture',3],['root cause',3],['model',1]],
    'Detail Observer':     [['detail',3],['notice',2],['precise',3],['specific',2],['exact',2],['careful',2],['nuance',3],['subtle',2]],
    'Intuitive Reader':    [['intuition',3],['gut',3],['instinct',3],['sense that',2],['vibe',2],['feel like',1],['something tells me',3]],
    'Curious Explorer':    [['curious',3],['wonder',2],['explore',2],['question',1],['why',1],['fascinated',3],['rabbit hole',3],['learn about',2]]
  },
  R: {
    'Deliberate Strategist':[['plan',2],['strategy',3],['prepare',2],['long term',3],['steps ahead',3],['roadmap',3],['think before',3],['calculated',3]],
    'Rapid Adapter':       [['adapt',3],['improvise',3],['flexible',2],['adjust',2],['pivot',3],['on the spot',3],['figure it out',2],['wing it',3]],
    'Steady Anchor':       [['calm',3],['composed',3],['patient',2],['steady',2],['unfazed',3],['keep my cool',3],['don\'t panic',3],['breathe',1]],
    'Intense Reactor':     [['frustrated',2],['angry',2],['overwhelm',3],['stress',2],['anxious',2],['panic',3],['explode',3],['snap',2],['burn out',3]]
  },
  I: {
    'Self-Architect':      [['discipline',3],['reinvent',3],['build myself',3],['self improvement',3],['routine',2],['my own path',3],['become',1],['transform',2]],
    'Conviction Holder':   [['believe',2],['principle',3],['values',3],['stand for',3],['integrity',3],['won\'t compromise',3],['right thing',2]],
    'Independent Mind':    [['my own way',3],['independent',3],['alone',1],['self reliant',3],['don\'t follow',3],['contrarian',3],['my own terms',3]],
    'Identity Seeker':     [['who am i',3],['identity',2],['lost',2],['finding myself',3],['don\'t know what',2],['figuring out who',3],['unsure',2]]
  },
  S: {
    'Connector':           [['friends',2],['team',2],['together',2],['community',3],['network',2],['collaborate',3],['everyone',1],['hang out',2]],
    'Selective Bonder':    [['small circle',3],['few close',3],['trust slowly',3],['deep friendship',3],['one or two people',3],['inner circle',3]],
    'Influencer':          [['lead',2],['convince',2],['persuade',3],['inspire',2],['motivate others',3],['take charge',3],['my team',2]],
    'Empath':              [['understand them',3],['listen',2],['support',2],['help people',2],['feel their',3],['care about',2],['kindness',2],['empathy',3]]
  },
  M: {
    'Empire Builder':      [['ambition',3],['empire',3],['legacy',3],['vision',2],['build something',3],['long game',3],['great things',2],['change the world',3]],
    'Mastery Chaser':      [['master',3],['improve',2],['skill',2],['practice',2],['get better',2],['obsessed',3],['perfect',1],['craft',2],['deep work',3]],
    'Freedom Seeker':      [['freedom',3],['escape',2],['no boss',3],['autonomy',3],['my own terms',2],['independent life',3],['quit',2],['travel',1]],
    'Security Keeper':     [['stable',2],['security',3],['safe',2],['savings',2],['steady job',3],['comfortable',2],['risk averse',3],['settle',2]]
  }
};

const EXPL = {
  'Pattern Seeker':'Sees systems and structures beneath surface events.','Detail Observer':'Registers fine-grained information others miss.',
  'Intuitive Reader':'Processes situations through rapid non-verbal inference.','Curious Explorer':'Driven to dig into how and why things work.',
  'Deliberate Strategist':'Responds to pressure with structured forward planning.','Rapid Adapter':'Reconfigures quickly when circumstances shift.',
  'Steady Anchor':'Maintains equilibrium under stress.','Intense Reactor':'Experiences pressure vividly — high signal, high cost.',
  'Self-Architect':'Treats the self as a deliberate construction project.','Conviction Holder':'Anchors decisions in a stable internal code.',
  'Independent Mind':'Resists external definition; self-validates.','Identity Seeker':'Actively negotiating who they are — identity in motion.',
  'Connector':'Builds and maintains webs of relationships.','Selective Bonder':'Invests deeply in a small chosen circle.',
  'Influencer':'Naturally shapes group direction and opinion.','Empath':'Reads and absorbs the emotional states of others.',
  'Empire Builder':'Driven by large-scale, long-horizon creation.','Mastery Chaser':'Motivated by competence and depth itself.',
  'Freedom Seeker':'Optimizes for self-determination above status or safety.','Security Keeper':'Values stability and protected ground.'
};

const ARCH = {
  'P,M':['The Architect','Sees the system, builds the empire — strategy fused with ambition.'],
  'P,R':['The Tactician','Reads the board and moves with precision.'],
  'I,P':['The Philosopher','Turns observation inward into a coherent worldview.'],
  'P,S':['The Diplomat-Analyst','Decodes people as fluently as systems.'],
  'M,R':['The Executor','Converts drive into disciplined, relentless action.'],
  'I,R':['The Stoic','Self-possessed under fire, governed by inner code.'],
  'R,S':['The Commander','Steadies and directs the people around them.'],
  'I,M':['The Visionary','Self-built and aimed at something enormous.'],
  'I,S':['The Magnetic Core','A strong identity others orbit around.'],
  'M,S':['The Mobilizer','Builds movements, not just plans.']
};


const CAREERS = {
  'Pattern Seeker':[['Systems Analyst','Paid to find the structure under the chaos'],['Data Scientist','Patterns at scale, with proof'],['Strategy Consultant','Pattern-reading as a profession']],
  'Detail Observer':[['Quality / Test Engineer','The bug others ship, you catch'],['Forensic Analyst','Details are the entire job'],['Editor','Precision applied to language']],
  'Intuitive Reader':[['UX Researcher','Reading unspoken user needs'],['Negotiator / Sales Lead','Reads the room before the room speaks'],['Casting / Talent Scout','Spotting it before the data does']],
  'Curious Explorer':[['Research Scientist','Professional rabbit-holing'],['Investigative Journalist','Curiosity with a deadline'],['R&D Engineer','Paid to ask what if']],
  'Deliberate Strategist':[['Product Manager','Roadmaps are your native language'],['Operations Strategist','Long-game planning at company scale'],['Chess-style Quant / Planner','Calculated moves, measured risk']],
  'Rapid Adapter':[['Startup Generalist','Role changes weekly, you thrive'],['ER / Field Professional','Improvisation under real stakes'],['Live Production / Events','No second takes']],
  'Steady Anchor':[['Crisis Manager','Calm is the product'],['Air Traffic / Control Room Ops','Pressure without panic'],['Therapist / Counselor','Your stability becomes theirs']],
  'Intense Reactor':[['Creative Artist / Writer','High signal feeds the work'],['Advocacy / Activism','Intensity aimed at injustice'],['Performance Roles','The voltage becomes stage presence']],
  'Self-Architect':[['Founder','You build companies the way you build yourself'],['Athlete / Performance Coach','Discipline as a transferable system'],['Personal Brand Creator','The self is the product']],
  'Conviction Holder':[['Lawyer / Advocate','Principles with teeth'],['Policy / Ethics Roles','Values applied at scale'],['Nonprofit Leadership','Mission over margin']],
  'Independent Mind':[['Indie Developer / Solo Founder','No committee, no compromise'],['Freelance Specialist','Your way or no way — and it works'],['Research Maverick','Contrarian bets that pay off']],
  'Identity Seeker':[['Psychology / Counseling Path','Turn the search inward into expertise'],['Travel / Documentary Work','Find yourself by mapping the world'],['Liberal Arts → Specialize Later','Exploration is the strategy']],
  'Connector':[['Community Manager','Networks are your craft'],['Business Development','Relationships that convert'],['HR / People Ops','The human web, professionally']],
  'Selective Bonder':[['Small Elite Team Roles','Depth over headcount'],['Partnership-track Professions','Few relationships, high trust'],['Craft Studio / Boutique Agency','Tight crew, deep work']],
  'Influencer':[['Team Lead / Engineering Manager','People follow you anyway'],['Politics / Public Speaking','Persuasion at podium scale'],['Creator / Media Personality','Audience-building as career']],
  'Empath':[['Clinical Psychology','Emotional attunement, formalized'],['Social Work / Medicine','Care as a career'],['Customer Experience Lead','Empathy as competitive advantage']],
  'Empire Builder':[['Founder / CEO Track','The only role with enough ceiling'],['Venture Capital','Building empires by proxy'],['Film / Media Producer','Creative empires need architects']],
  'Mastery Chaser':[['Specialist Engineer','Depth is the moat'],['Surgeon / High-skill Craft','Ten thousand hours, gladly'],['Academic / Researcher','Mastery institutionalized']],
  'Freedom Seeker':[['Digital Nomad Consultant','Income without an office'],['Trader / Investor','Money working so you roam'],['Travel Content / Photography','The lifestyle is the job']],
  'Security Keeper':[['Government / PSU Roles','Stability engineered in'],['Banking / Actuarial','Risk measured, future protected'],['Infrastructure Engineering','Built to last, like your plans']]
};

const SHADOW = {
  P:'Perception gap — may act on assumptions instead of reading the situation first.',
  R:'Response gap — pressure can hit before a coping strategy is in place.',
  I:'Identity gap — outer demands and opinions can blur the inner code.',
  S:'Social gap — under-invests in the human web; support thins out when needed.',
  M:'Drive gap — capability without a pulling goal; energy scatters.'
};

function sentences(t){return t.replace(/\n+/g,' ').split(/(?<=[.!?])\s+/).filter(s=>s.trim().length>3);}
function countOcc(lower, phrase){
  let n=0,i=0; while((i=lower.indexOf(phrase,i))!==-1){n++;i+=phrase.length;} return n;
}

// Stylometric signals — vary scores even when lexicon misses
function styleSignals(text, lower, words){
  const W = Math.max(words.length,1);
  const c = re => (lower.match(re)||[]).length;
  return {
    P: (c(/\b(think|realize|notice|understand|analy[sz]e|observe|wonder|why|how)\b/g))/W*100,
    R: (c(/\b(handle|deal|manage|react|cope|pressure|deadline|challenge|problem)\b/g))/W*100,
    I: (c(/\b(i|me|my|myself)\b/g))/W*25 + (c(/\b(am|i'm)\b/g))/W*50,
    S: (c(/\b(we|us|our|friend|friends|people|family|team|together|everyone|them|they)\b/g))/W*60,
    M: (c(/\b(will|going to|want|goal|dream|future|someday|achieve|become|build)\b/g))/W*70
  };
}

function rulesEngine(text){
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  const sents = sentences(text);
  const lenFactor = Math.min(1, words.length/120); // longer text = more trustworthy scores

  const traits = [];
  const dimRaw = {P:0,R:0,I:0,S:0,M:0};

  for(const dim of Object.keys(LEX)){
    for(const [name, keys] of Object.entries(LEX[dim])){
      let raw=0, distinct=0, evidence='';
      for(const [k,w] of keys){
        const n = countOcc(lower,k);
        if(n>0){
          raw += Math.min(n,3)*w; distinct++;
          if(!evidence){const s=sents.find(s=>s.toLowerCase().includes(k));if(s)evidence=s.trim().slice(0,160);}
        }
      }
      if(raw>0){
        // Absolute trait score: signal strength + diversity of evidence
        const score = Math.min(95, Math.round(28 + raw*5 + distinct*6));
        traits.push({name, dim, score, evidence: evidence||'Inferred from overall tone.', explanation: EXPL[name]});
        dimRaw[dim] += raw + distinct*1.5;
      }
    }
  }

  // PRISM: absolute keyword signal blended with stylometric signal — no relative normalization
  const style = styleSignals(text, lower, words);
  const prism = {};
  for(const d of ['P','R','I','S','M']){
    const kw = Math.min(60, dimRaw[d]*4.5);             // 0..60 from lexicon
    const st = Math.min(28, style[d]);                   // 0..28 from writing style
    prism[d] = Math.round(Math.max(8, Math.min(97, (12 + kw + st) * (0.6 + 0.4*lenFactor))));
  }

  // Archetype: top-2 dims, with trait-signature overrides when one trait dominates
  const SIGNATURE = {
    'Empire Builder':['The Architect','Sees the system, builds the empire — strategy fused with scale.'],
    'Freedom Seeker':['The Free Agent','Allergic to cages — optimizes life for self-determination.'],
    'Intense Reactor':['The Storm-Walker','Feels pressure at full volume and is learning to channel it.'],
    'Identity Seeker':['The Becoming','Identity under active construction — the most honest place to be.'],
    'Empath':['The Resonant','Tuned to the emotional frequency of every room.'],
    'Rapid Adapter':['The Improviser','No script needed — reads the moment and moves.'],
    'Mastery Chaser':['The Craftsman','Depth over breadth; the work itself is the reward.'],
    'Security Keeper':['The Groundskeeper','Builds protected, stable ground before reaching higher.']
  };
  traits.sort((a,b)=>b.score-a.score);
  const ranked = Object.entries(prism).sort((a,b)=>b[1]-a[1]);
  const [d1,v1]=ranked[0], [d2,v2]=ranked[1];
  const spread = v1 - ranked[4][1];
  let archetype;
  const sig = traits[0] && traits[0].score>=88 && (traits.length<2 || traits[0].score>=traits[1].score) ? SIGNATURE[traits[0].name] : null;
  if(spread < 10 || traits.length===0){
    archetype = {primary:'The Unwritten', description:'Signal too thin or too balanced to classify — write more, write rawer.', confidence: 0.25};
  } else if(sig){
    const confidence = Math.min(0.92, 0.35 + traits.length*0.05 + lenFactor*0.15);
    archetype = {primary:sig[0], description:sig[1], confidence: Math.round(confidence*100)/100};
  } else {
    const key=[d1,d2].sort().join(',');
    const a = ARCH[key] || [`The ${({P:'Observer',R:'Responder',I:'Individual',S:'Social',M:'Driven'})[d1]}`,'A profile led by '+d1+' and '+d2+'.'];
    const confidence = Math.min(0.92, 0.3 + traits.length*0.05 + spread*0.006 + lenFactor*0.15);
    archetype = {primary:a[0], description:a[1], confidence: Math.round(confidence*100)/100};
  }

  // Shadow: every dim under 42 gets a line; if none, flag the gap between top and bottom
  const shadow = ranked.filter(([,v])=>v<42).map(([d])=>SHADOW[d]).slice(0,3);
  if(!shadow.length && spread>30) shadow.push(`Lopsided engine — ${({P:'Perception',R:'Response',I:'Identity',S:'Social',M:'Motivation'})[d1]} dominates; the weakest dimension gets starved under pressure.`);

  // Emergent: contradictory trait pairs = interesting tension
  const has = n => traits.some(t=>t.name===n && t.score>55);
  const emergent = [];
  if(has('Connector')&&has('Selective Bonder')) emergent.push('Social code-switching — broad network outside, tiny trusted core inside.');
  if(has('Deliberate Strategist')&&has('Rapid Adapter')) emergent.push('Dual-mode operator — plans deeply but discards the plan without grief.');
  if(has('Empire Builder')&&has('Security Keeper')) emergent.push('Anchored ambition — wants the empire and the safety net simultaneously.');
  if(has('Steady Anchor')&&has('Intense Reactor')) emergent.push('Pressure-cooker calm — composed surface over a high-voltage interior.');
  if(has('Identity Seeker')&&has('Conviction Holder')) emergent.push('Convictions under construction — strong values, still wiring them into identity.');

  // Careers: drawn from the top traits, deduped, reason cites the trait
  const careers = [];
  const seenC = new Set();
  for(const t of traits.slice(0,5)){
    for(const [job,why] of (CAREERS[t.name]||[])){
      if(!seenC.has(job)){ seenC.add(job); careers.push({title:job, reason:why+'.', from:t.name, fit:Math.min(95, t.score+(careers.length? -4*careers.length:0))}); }
      if(careers.length>=6) break;
    }
    if(careers.length>=6) break;
  }

  const DN={P:'Perception',R:'Response',I:'Identity',S:'Social',M:'Motivation'};
  const top3 = traits.slice(0,3).map(t=>t.name).join(', ');
  const narrative = archetype.primary==='The Unwritten'
    ? `Only ${words.length} words of signal across ${sents.length} statements — the engine needs more raw material. Write about a real decision, a conflict, or what you want in five years.`
    : `${archetype.primary}: ${archetype.description} Dominant axis: ${DN[d1]} (${v1}) backed by ${DN[d2]} (${v2}). Leading traits — ${top3}. Profile drawn from ${words.length} words, ${traits.length} traits detected.`;

  return {prism, archetype, traits: traits.slice(0,12), shadow, emergent, careers, narrative};
}

const SYSTEM_PROMPT = `You are the PRISM personality analysis engine. PRISM scores five dimensions 0-100:
- P (Perception): how the person takes in and models the world — pattern-seeking, detail, intuition.
- R (Response): how they react to pressure and change — planning, adaptation, composure.
- I (Identity): strength and construction of self — conviction, independence, self-authorship.
- S (Social): how they relate — connection breadth, depth, influence.
- M (Motivation): what drives them — ambition scale, mastery, autonomy.

Analyze the user's text. Respond with ONLY valid JSON, no markdown fences, no commentary:
{
 "prism": {"P":n,"R":n,"I":n,"S":n,"M":n},
 "archetype": {"primary":"2-3 word title","description":"one sentence","confidence":0.0-1.0},
 "traits": [{"name":"...","dim":"P|R|I|S|M","score":0-100,"evidence":"short quote or paraphrase from the text","explanation":"one sentence"}],
 "shadow": ["1-3 likely blind spots or under-developed sides, one sentence each"],
 "emergent": ["0-3 unusual traits that don't fit standard categories"],
 "careers": [{"title":"...","reason":"one sentence tying it to a detected trait","fit":0-100}],
 "narrative": "2-3 sentence psychological portrait, direct and specific, no flattery padding"
}
Rules: 5-10 traits max. 4-6 careers, each justified by a specific detected trait — never generic. Evidence must trace to the actual text. Use the full 0-100 range — differentiate dimensions sharply, avoid clustering scores. Confidence reflects how much signal the text contains. Be honest — thin text gets low confidence and fewer traits.`;

async function claudeEngine(text, apiKey, model){
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{role:'user', content: text.slice(0, 6000)}]
    })
  });
  if(!resp.ok) throw new Error('Claude API ' + resp.status);
  const d = await resp.json();
  const raw = (d.content||[]).map(c=>c.text||'').join('').replace(/```json|```/g,'').trim();
  const parsed = JSON.parse(raw);
  if(!parsed.prism || !parsed.archetype) throw new Error('Malformed analysis');
  return parsed;
}

function hashText(text){return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');}

module.exports = { rulesEngine, claudeEngine, hashText, ENGINE_VERSION };
