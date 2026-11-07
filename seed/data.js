/* Intellect — mock research-lab dataset.
   Plain JS, attaches window.DATA. Cross-referenced by short ids. */
(function () {
  // ---- People ----------------------------------------------------------
  const people = {
    hv: { id: "hv", name: "Helena Vance",     init: "HV", role: "Lab Director",          title: "Chief", team: "Directorate" },
    mo: { id: "mo", name: "Marcus Okonkwo",   init: "MO", role: "Principal Investigator", title: "PI", team: "Cognitive Systems" },
    pr: { id: "pr", name: "Priya Raman",      init: "PR", role: "Principal Investigator", title: "PI", team: "Quantum & Sensing" },
    sa: { id: "sa", name: "Sofia Almeida",    init: "SA", role: "Principal Investigator", title: "PI", team: "Energy & Materials" },
    dw: { id: "dw", name: "Daniel Whitfield", init: "DW", role: "Principal Investigator", title: "PI", team: "Autonomy" },
    lk: { id: "lk", name: "Lena Kirchner",    init: "LK", role: "Principal Investigator", title: "PI", team: "Synthetic Biology" },
    am: { id: "am", name: "Arjun Mehta",      init: "AM", role: "Principal Investigator", title: "PI", team: "Climate Systems" },
    // researchers
    jt: { id: "jt", name: "Jonah Tran",       init: "JT", role: "Staff Scientist", title: "Staff", team: "Cognitive Systems" },
    ec: { id: "ec", name: "Elena Castellanos",init: "EC", role: "Postdoc",        title: "Postdoc", team: "Cognitive Systems" },
     rb: { id: "rb", name: "Rafael Brandt",   init: "RB", role: "Staff Scientist", title: "Staff", team: "Energy & Materials" },
    ny: { id: "ny", name: "Naomi Yusuf",      init: "NY", role: "Postdoc",        title: "Postdoc", team: "Autonomy" },
  };

  // helper to make a sparkline series
  const series = (arr) => arr;

  // ---- Topics ----------------------------------------------------------
  // health: healthy | watch | at-risk
  // coverage = % of open gaps with active work against them
  const topics = [
    {
      id: "t-neuro", bin:1, name: "Neuromorphic Computing", lead: "mo", team: "Cognitive Systems",
      health: "at-risk", coverage: 0.42, momentum: -8, priority: "Flagship",
      summary: "Brain-inspired hardware/algorithms for ultra-low-power inference at the edge.",
      questions: 6, gaps: 5, openGaps: 4, work: 4, papers: 4,
      trend: series([41, 44, 43, 48, 52, 49, 55, 53, 58, 54, 51, 47]),
      tags: ["hardware", "edge", "energy-efficiency"],
      sponsors: ["DARPA MTO", "Internal Seed"],
    },
    {
      id: "t-carbon", bin:1, name: "Carbon-Negative Materials", lead: "sa", team: "Energy & Materials",
      health: "watch", coverage: 0.71, momentum: 12, priority: "Flagship",
      summary: "Mineralization & polymer routes that sequester more CO₂ than they emit.",
      questions: 5, gaps: 4, openGaps: 2, work: 5, papers: 3,
      trend: series([22, 25, 28, 31, 30, 34, 38, 41, 44, 47, 52, 56]),
      tags: ["materials", "climate", "scale-up"],
      sponsors: ["DOE", "Breakthrough Energy"],
    },
    {
      id: "t-swarm", bin:2, name: "Autonomous Swarm Coordination", lead: "dw", team: "Autonomy",
      health: "healthy", coverage: 0.83, momentum: 5, priority: "Core",
      summary: "Decentralized control for large multi-agent teams under comms denial.",
      questions: 5, gaps: 3, openGaps: 1, work: 4, papers: 3,
      trend: series([60, 62, 61, 64, 66, 65, 68, 70, 69, 72, 74, 73]),
      tags: ["autonomy", "robotics", "control"],
      sponsors: ["ONR", "Army RDECOM"],
    },
    { id: "t-quantum", bin:2, name: "Quantum Sensing", lead: "pr", team: "Quantum & Sensing",
      health: "healthy", coverage: 0.78, momentum: 9, priority: "Core",
      summary: "NV-center magnetometry & cold-atom inertial sensing beyond the SQL.",
      questions: 4, gaps: 3, openGaps: 1, work: 3, papers: 3, tags:["quantum","sensing"],
      trend: series([48,50,52,51,55,57,59,58,61,63,66,68]), sponsors:["NSF","IARPA"] },
    { id: "t-synbio", bin:2, name: "Synthetic Biology Safety", lead: "lk", team: "Synthetic Biology",
      health: "watch", coverage: 0.55, momentum: -3, priority: "Core",
      summary: "Biocontainment, kill-switches and screening for engineered organisms.",
      questions: 5, gaps: 4, openGaps: 3, work: 3, papers: 2, tags:["biosafety","policy"],
      trend: series([34,36,33,38,40,37,41,39,42,40,38,37]), sponsors:["NIH","Open Phil"] },
    { id: "t-climate", bin:2, name: "Climate Resilience Modeling", lead: "am", team: "Climate Systems",
      health: "at-risk", coverage: 0.33, momentum: -14, priority: "Core",
      summary: "Downscaled risk models for compound climate hazards on infrastructure.",
      questions: 6, gaps: 6, openGaps: 5, work: 3, papers: 2, tags:["climate","modeling"],
      trend: series([52,49,47,45,43,40,38,36,33,31,29,27]), sponsors:["NOAA","State of CA"] },
    { id: "t-advml", bin:3, name: "Adversarial ML Robustness", lead: "mo", team: "Cognitive Systems",
      health: "healthy", coverage: 0.80, momentum: 6, priority: "Core",
      summary: "Certified defenses & evaluation for safety-critical perception models.",
      questions: 4, gaps: 3, openGaps: 1, work: 3, papers: 3, tags:["ml","security"],
      trend: series([44,46,48,47,50,52,54,53,56,58,60,62]), sponsors:["DARPA GARD"] },
    { id: "t-grid", bin:3, name: "Grid-Scale Energy Storage", lead: "sa", team: "Energy & Materials",
      health: "watch", coverage: 0.62, momentum: 3, priority: "Core",
      summary: "Iron-air & flow chemistries for multi-day grid storage economics.",
      questions: 4, gaps: 3, openGaps: 2, work: 3, papers: 2, tags:["energy","storage"],
      trend: series([38,40,39,42,44,43,45,47,46,48,50,49]), sponsors:["DOE","Form Energy"] },
    { id: "t-bioinsp", bin:3, name: "Bio-Inspired Materials", lead: "lk", team: "Synthetic Biology",
      health: "healthy", coverage: 0.75, momentum: 4, priority: "Emerging",
      summary: "Self-healing & structural materials templated on biological motifs.",
      questions: 3, gaps: 2, openGaps: 1, work: 2, papers: 2, tags:["materials","bio"],
      trend: series([30,32,33,35,34,37,39,41,43,42,45,47]), sponsors:["AFOSR"] },
    { id: "t-edge", bin:4, name: "Edge AI for Sensing", lead: "dw", team: "Autonomy",
      health: "watch", coverage: 0.58, momentum: -2, priority: "Emerging",
      summary: "On-device perception under tight power and latency envelopes.",
      questions: 4, gaps: 3, openGaps: 2, work: 2, papers: 2, tags:["edge","ml"],
      trend: series([42,43,41,44,43,45,44,46,45,44,43,42]), sponsors:["Internal Seed"] },
    { id: "t-privacy", bin:4, name: "Privacy-Preserving Computation", lead: "pr", team: "Quantum & Sensing",
      health: "healthy", coverage: 0.85, momentum: 7, priority: "Emerging",
      summary: "Practical MPC & FHE for cross-org scientific collaboration.",
      questions: 3, gaps: 2, openGaps: 0, work: 2, papers: 2, tags:["crypto","privacy"],
      trend: series([28,30,32,34,36,38,40,42,44,46,48,50]), sponsors:["NSF"] },
    { id: "t-wildfire", bin:4, name: "Wildfire Prediction Systems", lead: "am", team: "Climate Systems",
      health: "watch", coverage: 0.50, momentum: 1, priority: "Emerging",
      summary: "Fusing satellite, sensor and weather data for ignition forecasting.",
      questions: 4, gaps: 4, openGaps: 2, work: 2, papers: 1, tags:["climate","sensing"],
      trend: series([36,38,37,39,41,40,42,41,43,42,44,43]), sponsors:["CAL FIRE","NASA"] },
  ];

  // ---- Questions / Gaps / Work / Papers (deeply linked for showcase topics)
  // Questions
  const questions = [
    // Neuromorphic
    { id:"q1", topic:"t-neuro", text:"Can spiking architectures match transformer accuracy at <1% of the energy?", status:"open", owner:"mo", gaps:["g1","g2"] },
    { id:"q2", topic:"t-neuro", text:"What memristor materials hold state reliably past 10⁹ cycles?", status:"partially", owner:"jt", gaps:["g3"] },
    { id:"q3", topic:"t-neuro", text:"How do we train on-chip without a von-Neumann backprop pass?", status:"open", owner:"ec", gaps:["g2","g4"] },
    { id:"q4", topic:"t-neuro", text:"Is there a compiler path from PyTorch to neuromorphic substrates?", status:"answered", owner:"mo", gaps:["g5"] },
    // Carbon
    { id:"q5", topic:"t-carbon", text:"Which mineralization pathway scales below $80/ton captured?", status:"partially", owner:"sa", gaps:["g6","g7"] },
    { id:"q6", topic:"t-carbon", text:"Do CO₂-cured polymers retain structural rating over 30 years?", status:"open", owner:"rb", gaps:["g8"] },
    // Climate (at-risk, undercovered)
    { id:"q7", topic:"t-climate", text:"How do compound flood+heat events propagate through power grids?", status:"open", owner:"am", gaps:["g9","g10"] },
    { id:"q8", topic:"t-climate", text:"Can we downscale risk to census-tract resolution under 6h?", status:"open", owner:"am", gaps:["g11"] },
  ];

  // Gaps — severity: critical|high|medium ; status: open|addressing|closing|closed
  const gaps = [
    { id:"g1", topic:"t-neuro", text:"No benchmark suite for energy-normalized accuracy on spiking nets.", severity:"high", status:"addressing", work:["w1"], owner:"mo" },
    { id:"g2", topic:"t-neuro", text:"On-chip learning rule that is local & stable is unproven at scale.", severity:"critical", status:"addressing", work:["w2"], owner:"ec" },
    { id:"g3", topic:"t-neuro", text:"Memristor endurance data above 10⁸ cycles is missing.", severity:"high", status:"open", work:[], owner:"jt" },
    { id:"g4", topic:"t-neuro", text:"No theory linking sparsity to generalization in SNNs.", severity:"medium", status:"open", work:[], owner:"ec" },
    { id:"g5", topic:"t-neuro", text:"Toolchain lacks quantization-aware mapping.", severity:"medium", status:"closing", work:["w3","w4"], owner:"mo" },
    // Carbon
    { id:"g6", topic:"t-carbon", text:"Reaction kinetics unknown for seawater-buffered routes.", severity:"high", status:"addressing", work:["w5"], owner:"sa" },
    { id:"g7", topic:"t-carbon", text:"No techno-economic model validated against pilot data.", severity:"medium", status:"closing", work:["w6"], owner:"rb" },
    { id:"g8", topic:"t-carbon", text:"Long-term durability of CO₂-cured concrete unverified.", severity:"high", status:"open", work:[], owner:"rb" },
    // Climate
    { id:"g9", topic:"t-climate", text:"No coupled flood–grid failure dataset exists.", severity:"critical", status:"open", work:[], owner:"am" },
    { id:"g10", topic:"t-climate", text:"Cascading-failure model is uncalibrated.", severity:"critical", status:"open", work:["w7"], owner:"am" },
    { id:"g11", topic:"t-climate", text:"Downscaling pipeline misses the 6h latency target by 4×.", severity:"high", status:"addressing", work:["w8"], owner:"am" },
  ];

  // Work in progress — status: planning|active|blocked|review|complete
  const work = [
    { id:"w1", topic:"t-neuro", title:"NeuroBench-E harness", status:"active", lead:"jt", team:["jt","ec"], progress:0.6, due:"2026-08-15", gaps:["g1"], papers:[], note:"Energy-normalized benchmark across 7 substrates." },
    { id:"w2", topic:"t-neuro", title:"Local plasticity learning rule", status:"blocked", lead:"ec", team:["ec","mo"], progress:0.35, due:"2026-10-01", gaps:["g2"], papers:[], note:"Blocked on fab run for test chips (Q3)." },
    { id:"w3", topic:"t-neuro", title:"PyTorch→substrate compiler", status:"review", lead:"mo", team:["mo","jt"], progress:0.9, due:"2026-06-30", gaps:["g5"], papers:["p4"], note:"In internal review; targeting open-source release." },
    { id:"w4", topic:"t-neuro", title:"Quantization-aware mapping", status:"active", lead:"jt", team:["jt"], progress:0.5, due:"2026-09-10", gaps:["g5"], papers:[], note:"" },
    // Carbon
    { id:"w5", topic:"t-carbon", title:"Seawater mineralization pilot", status:"active", lead:"sa", team:["sa","rb"], progress:0.55, due:"2026-11-01", gaps:["g6"], papers:["p5"], note:"" },
    { id:"w6", topic:"t-carbon", title:"TEA model v2", status:"review", lead:"rb", team:["rb"], progress:0.85, due:"2026-07-20", gaps:["g7"], papers:[], note:"" },
    // Climate
    { id:"w7", topic:"t-climate", title:"Cascading-failure simulator", status:"planning", lead:"am", team:["am"], progress:0.15, due:"2026-12-01", gaps:["g10"], papers:[], note:"Awaiting data-sharing MOU with utility." },
    { id:"w8", topic:"t-climate", title:"GPU downscaling rewrite", status:"active", lead:"am", team:["am"], progress:0.4, due:"2026-09-30", gaps:["g11"], papers:[], note:"" },
  ];

  // Papers — published. readership block + feedback.
  const papers = [
    {
      id:"p1", topic:"t-neuro", title:"Sparse Spiking Networks Approach Dense Accuracy at 40× Lower Energy",
      venue:"Nature Machine Intelligence", year:2025, month:"Nov", authors:["mo","ec","jt"],
      addresses:["q1"], gaps:["g1"],
      reads:{ downloads:18420, views:46100, citations:73, altmetric:284 },
      readTrend:series([200,420,690,1100,1640,2200,2950,3700,4500,5400,6300,7200]),
      audience:{ academic:54, industry:23, government:14, nonprofit:9 },
      geo:[["United States",38],["China",14],["Germany",9],["United Kingdom",7],["Japan",6],["Other",26]],
      split:{ internal:6, external:94 },
      mentions:{ news:11, policy:3, social:128, patents:2 },
      feedback:[
        { type:"peer", who:"Reviewer 2 · Nat. Mach. Intell.", sentiment:"mixed", text:"Energy claims are compelling, but the baseline transformer is under-tuned; rerun with FlashAttention.", date:"2025-09-02" },
        { type:"reader", who:"Dr. K. Sato, RIKEN", sentiment:"positive", text:"We reproduced the 40× figure on our Loihi-2 setup. Excellent harness.", date:"2025-12-10" },
        { type:"sponsor", who:"DARPA MTO PM", sentiment:"positive", text:"Exactly the kind of normalized benchmark the program needs. Let's brief the directorate.", date:"2026-01-18" },
      ],
    },
    {
      id:"p4", topic:"t-neuro", title:"A Retargetable Compiler Bridge from PyTorch to Neuromorphic Substrates",
      venue:"MLSys", year:2026, month:"Mar", authors:["mo","jt"],
      addresses:["q4"], gaps:["g5"],
      reads:{ downloads:9100, views:21400, citations:12, altmetric:96 },
      readTrend:series([120,300,520,760,1040,1360,1700,2080,2480,2900,3340,3800]),
      audience:{ academic:41, industry:46, government:8, nonprofit:5 },
      geo:[["United States",44],["Germany",11],["South Korea",8],["United Kingdom",6],["Other",31]],
      split:{ internal:9, external:91 },
      mentions:{ news:4, policy:0, social:61, patents:1 },
      feedback:[
        { type:"reader", who:"Open-source issue #142", sentiment:"mixed", text:"Compiler crashes on grouped convolutions — repro attached.", date:"2026-04-03" },
        { type:"peer", who:"MLSys AC", sentiment:"positive", text:"Strong systems contribution; accept with minor revisions.", date:"2026-01-09" },
      ],
    },
    {
      id:"p5", topic:"t-carbon", title:"Seawater-Buffered Mineralization for Sub-$80/ton CO₂ Capture",
      venue:"Joule", year:2026, month:"Feb", authors:["sa","rb"],
      addresses:["q5"], gaps:["g6"],
      reads:{ downloads:12600, views:33800, citations:21, altmetric:512 },
      readTrend:series([180,460,820,1280,1840,2500,3260,4120,5080,6140,7300,8560]),
      audience:{ academic:36, industry:34, government:22, nonprofit:8 },
      geo:[["United States",33],["China",16],["India",9],["Australia",8],["Other",34]],
      split:{ internal:5, external:95 },
      mentions:{ news:27, policy:9, social:340, patents:4 },
      feedback:[
        { type:"sponsor", who:"DOE Program Office", sentiment:"positive", text:"Cost trajectory aligns with the Earthshot target. Requesting a scale-up proposal.", date:"2026-03-22" },
        { type:"reader", who:"J. Okafor, climate journalist", sentiment:"positive", text:"Clearest TEA I've read this year — wrote it up for the column.", date:"2026-02-28" },
        { type:"peer", who:"Reviewer 1 · Joule", sentiment:"mixed", text:"Durability over decades remains unaddressed; flag as limitation.", date:"2025-12-15" },
      ],
    },
  ];

  // Lab-level aggregate (reflects the full ~200-topic portfolio)
  const lab = {
    name: "Meridian Research Institute",
    short: "Meridian",
    portfolio: { topics: 200, activeQuestions: 612, openGaps: 184, gapsCovered: 0.61,
                 workInFlight: 147, papersYTD: 38, readsYTD: 412000, citationsYTD: 1840 },
    readTrend: series([301,322,318,340,366,358,381,395,402,418,430,447]),
    healthMix: { healthy: 96, watch: 72, atRisk: 32 },
    binMix: { 1:18, 2:46, 3:64, 4:72 }, binRisk: { 1:7, 2:11, 3:8, 4:6 },
    sponsors: [["DARPA",24],["DOE",19],["NSF",17],["NIH",11],["ONR",9],["Other",20]],
  };

  // ---- Resourcing: budgets ($M, FY26) + FTE allocations -----------------
  const topicBudget = {
    't-neuro':[3.8,1.9],'t-carbon':[4.2,2.6],'t-swarm':[2.9,1.7],'t-quantum':[2.4,1.3],
    't-synbio':[1.8,1.1],'t-climate':[2.2,1.5],'t-advml':[1.6,0.9],'t-grid':[2.7,1.4],
    't-bioinsp':[1.1,0.5],'t-edge':[0.9,0.6],'t-privacy':[0.8,0.3],'t-wildfire':[1.0,0.7],
  };
  topics.forEach(t=>{ const b=topicBudget[t.id]||[1.0,0.5]; t.budget={ allocated:b[0], spent:b[1], fy:'FY26' }; });

  // person → [[topicId, fte], ...] ; cap = FTE capacity
  const alloc = {
    mo:[['t-neuro',0.5],['t-advml',0.3]],
    pr:[['t-quantum',0.5],['t-privacy',0.4]],
    sa:[['t-carbon',0.5],['t-grid',0.4]],
    dw:[['t-swarm',0.5],['t-edge',0.4]],
    lk:[['t-synbio',0.5],['t-bioinsp',0.4]],
    am:[['t-climate',0.7],['t-wildfire',0.5]],   // 1.2 — over capacity
    jt:[['t-neuro',0.7],['t-advml',0.3]],
    ec:[['t-neuro',0.8]],
    rb:[['t-carbon',0.6],['t-grid',0.4]],
    ny:[['t-swarm',0.7],['t-edge',0.3]],
    hv:[],
  };
  Object.entries(alloc).forEach(([pid,list])=>{ if(people[pid]){ people[pid].alloc=list; people[pid].cap=1.0; people[pid].load=Math.round(list.reduce((s,a)=>s+a[1],0)*10)/10; } });
  // roll up per-topic FTE + core team
  topics.forEach(t=>{ let fte=0, ppl=[]; Object.values(people).forEach(p=>{ (p.alloc||[]).forEach(([tid,f])=>{ if(tid===t.id){ fte+=f; ppl.push(p.id); } }); }); t.fte=Math.round(fte*10)/10; t.team_ids=ppl; });

  // experiments (work) → budget ($M) + fte
  const workBudget = { w1:[0.6,0.36,1.5], w2:[0.9,0.32,1.2], w3:[0.4,0.36,1.0], w4:[0.5,0.25,0.7], w5:[1.3,0.72,1.1], w6:[0.3,0.26,0.6], w7:[0.7,0.10,0.8], w8:[0.6,0.24,0.5] };
  work.forEach(w=>{ const b=workBudget[w.id]||[0.3,0.15,0.5]; w.budget={ allocated:b[0], spent:b[1] }; w.fte=b[2]; });

  // lab-scale resourcing (reflects full ~200-topic portfolio)
  lab.budget = { fy:'FY26', allocated:47.5, committed:38.2, spent:21.6 };
  lab.headcount = 142;            // total FTE
  lab.binBudget = { 1:14.2, 2:16.8, 3:9.7, 4:6.8 };   // $M by priority
  lab.binFte    = { 1:38, 2:49, 3:32, 4:23 };          // FTE by priority

  // ---- Downstream citations: who cited our papers (extends the spine) ----
  const citing = {
    p1: { more:70, list:[
      { id:"c1", title:"Energy-Aware Neuromorphic Inference at the Tactical Edge", venue:"IEEE TNNLS", year:2026, org:"MIT Lincoln Lab", sector:"government" },
      { id:"c2", title:"A Survey of Spiking Neural Network Benchmarks", venue:"ACM Computing Surveys", year:2026, org:"ETH Zürich", sector:"academic" },
      { id:"c3", title:"Loihi-3: Production SNN Deployment Whitepaper", venue:"Intel Labs TR", year:2026, org:"Intel", sector:"industry" },
    ]},
    p4: { more:10, list:[
      { id:"c7", title:"Cross-Substrate ML Compilation", venue:"ASPLOS", year:2026, org:"Univ. of Washington", sector:"academic" },
      { id:"c8", title:"Production Neuromorphic Toolchains", venue:"arXiv", year:2026, org:"Qualcomm AI", sector:"industry" },
    ]},
    p5: { more:18, list:[
      { id:"c4", title:"IPCC AR7 WG-III — Carbon Dioxide Removal Pathways", venue:"IPCC", year:2026, org:"IPCC", sector:"policy" },
      { id:"c5", title:"Techno-economics of Ocean Alkalinity Enhancement", venue:"Nature Sustainability", year:2026, org:"Stanford", sector:"academic" },
      { id:"c6", title:"Mineralization Scale-up: A Cost Teardown", venue:"Joule", year:2026, org:"Form Energy", sector:"industry" },
    ]},
  };
  papers.forEach(p=>{ const c=citing[p.id]; p.citedBy = c? c.list : []; p.citeMore = c? c.more : 0; });

  // ---- Sub-labs (Centers): group the institute's teams under directorates ----
  // Each center rolls up several teams; each team rolls up its topics.
  const subLabs = [
    { id:"sl-intel", name:"Center for Intelligent Systems", short:"Intelligent Systems", code:"CIS",
      lead:"mo", teams:["Cognitive Systems","Autonomy"],
      focus:"Learning, perception and autonomy — from low-power hardware to multi-agent control." },
    { id:"sl-energy", name:"Center for Energy & Climate", short:"Energy & Climate", code:"CEC",
      lead:"sa", teams:["Energy & Materials","Climate Systems"],
      focus:"Decarbonization materials, grid-scale storage and climate-risk modeling." },
    { id:"sl-quantum", name:"Center for Quantum & Life Sciences", short:"Quantum & Life", code:"CQL",
      lead:"pr", teams:["Quantum & Sensing","Synthetic Biology"],
      focus:"Quantum sensing, privacy-preserving computation and engineered biology." },
  ];

  window.DATA = { people, topics, questions, gaps, work, papers, lab, subLabs };
})();
