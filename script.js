// script.js — win layout (10/row) + "You Win!" message, keeps colors
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

	// === BACKGROUND IMAGE ===
	const bkg = new Image();
	let bkgReady = false;
	bkg.onload = () => { bkgReady = true; };
	bkg.src = "images/bkg.jpg";

  // === GLOBAL SPEED MODIFIER ===
  // 1.0 = current speed, 0.7 = 70%, 1.3 = 130%, etc.
  const speedMod = .5;

	// preload sounds
	const primeSounds = [
		new Audio("sounds/p1.mp3"),
		new Audio("sounds/p2.mp3"),
		new Audio("sounds/p3.mp3"),
		new Audio("sounds/p4.mp3"),
		new Audio("sounds/p5.mp3"),
		new Audio("sounds/p6.mp3"),
		new Audio("sounds/p7.mp3"),
		new Audio("sounds/p8.mp3"),
	];
	const winSound = new Audio("sounds/win.mp3");
	// (optional) hint the browser to load them
	for (const a of primeSounds) a.load();
	winSound.load();

  // helpers
  let W=0,H=0,DPR=Math.max(1,window.devicePixelRatio||1);
  const now=()=>performance.now();
  const rand=(a,b)=>a+Math.random()*(b-a);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const isPrime=(n)=>{ if(n<2) return false; if(n%2===0) return n===2;
    const r=Math.floor(Math.sqrt(n)); for(let i=3;i<=r;i+=2) if(n%i===0) return false; return true; };
  const nextPrimeAbove=(n)=>{ let x=n+1; while(!isPrime(x)) x++; return x; };
  const easeOutCubic=(t)=>1-Math.pow(1-t,3);

  // ui
  const ui = { fontFamily: "system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
               fontSize:16, headerH:48, buttonH:40, btnPad:8, buttons:[] };

  function resize(){
    W=window.innerWidth; H=window.innerHeight;
    updateSpeedBands();
    canvas.width = Math.floor(W*DPR); canvas.height = Math.floor(H*DPR);
    canvas.style.width=W+"px"; canvas.style.height=H+"px";
    ctx.setTransform(DPR,0,0,DPR,0,0);
    ui.fontSize = Math.max(14, Math.min(W,H)*0.024);
    ui.headerH = ui.fontSize*2.2+8;
    ui.buttonH = ui.fontSize*1.6+8;
    ui.btnPad = Math.max(6, ui.fontSize*0.4);
    placeButtons();
    if (winMode) computeWinLayout(); // keep grid responsive
  }

  function placeButtons(){
    ui.buttons.length = 0;
    const bw = Math.min(120, Math.max(72, W/10));
    const y = ui.btnPad;
		// existing 2, 3 button
		ui.buttons.push({
			label: "2, 3",
			x: ui.btnPad,
			y,
			w: bw,
			h: Math.round(ui.buttonH),
			onClick: bothHints,
			active: () => false
		});

		// NEW: GCF button (left side, next to "2, 3")
		ui.buttons.push({
			label: "GCF",
			x: ui.btnPad*2 + bw,
			y,
			w: bw,
			h: Math.round(ui.buttonH),
			onClick: startGcf,
			active: () => gcfActive
		});

		// NEW restart button in middle top
		const rbw = Math.min(120, Math.max(72, W/10));
		ui.buttons.push({
			label: "Restart",
			x: (W - rbw) / 2,     // center horizontally
			y,
			w: rbw,
			h: Math.round(ui.buttonH),
			onClick: () => {
				resetToStartState();
				start();
			},
			active: () => false
		});

  }

  // --- SPEED CONTROL (responsive to screen size) ---
  let SPEED_MIN_PPS = 240;
  let SPEED_TARGET_PPS = 420;
  let SPEED_MAX_PPS = 780;
  let DAMP_PER_FRAME = 0.996;

  function updateSpeedBands(){
    const minDim = Math.max(320, Math.min(W, H)); // guard super-small screens

    // Base bands from screen size
    const baseTarget = Math.round(minDim * 0.42);   // main feel
    const baseMin    = Math.round(baseTarget * 0.55);
    const baseMax    = Math.round(baseTarget * 1.60);

    // Apply global speed modifier uniformly to target, min, and max
    SPEED_TARGET_PPS = Math.max(10, Math.round(baseTarget * speedMod));
    SPEED_MIN_PPS    = Math.max(1,  Math.round(baseMin    * speedMod));
    SPEED_MAX_PPS    = Math.max(SPEED_MIN_PPS + 1, Math.round(baseMax * speedMod));

    // Damping unchanged (frame-based), but keep a tiny tweak for very small screens
    DAMP_PER_FRAME = (minDim < 550) ? 0.993 : 0.996;
  }

  function softClampSpeed(b){
    const s = Math.hypot(b.vx, b.vy);
    if (!isFinite(s) || s === 0) { b.vx = SPEED_TARGET_PPS/60; b.vy = 0; return; }
    const min = SPEED_MIN_PPS/60, max = SPEED_MAX_PPS/60;
    if (s > max){ const k = max / s; b.vx *= k; b.vy *= k; }
    else if (s < min){ const k = min / s; b.vx *= k; b.vy *= k; }
  }

  function setSpeedMagnitude(b, pps){
    const s = Math.hypot(b.vx, b.vy) || 1e-6;
    const k = (pps/60) / s;
    b.vx *= k; b.vy *= k;
  }

  // state
  let balls=[]; // {n,x,y,vx,vy,r,hit,bornAt,growMs,spawnScale, tx,ty}
  let startedAt=0, penalty=0, wrongClicks=0, running=false, finishedTime=null;
	let pauseStartedAt = 0; // when >0, clock is frozen at this time

  let currentMax=10;
  const MAX_N = 60;

  // hint flashes
  let evenFlashUntil=0, threeFlashUntil=0;

	// --- GCF mini-game state ---
	let gcfActive = false;          // pause flag + modal shown
	let gcfPair = null;             // { a:ball, b:ball, g:number }
	let gcfDom = null;              // overlay root

  // click effects (spirals)
  const effects=[]; // {x,y,start,duration,startR,turns}

  // win layout state
  let winMode = false;      // arranging grid
  let winStartedAt = 0;
  let grid = { cols:10, rows:0, cellW:0, cellH:0, top:0, left:0, bottom:0 };

  function addBall(n, animate = true){
    const minDim = Math.min(W, H);
    const baseR = clamp(Math.floor(minDim*0.022), 14, 26);

    const spawnScale = animate ? 3 : 1;
    const rEff = baseR * spawnScale;
    const { x, y } = findSpawnPosition(rEff);

    const ang = rand(0, Math.PI * 2);
    const tgt = SPEED_TARGET_PPS * (0.95 + Math.random()*0.10); // already speedMod-scaled

    let vx = Math.cos(ang), vy = Math.sin(ang);
    const tmp = { vx, vy };
    setSpeedMagnitude(tmp, tgt);
    vx = tmp.vx; vy = tmp.vy;

    balls.push({
      n, x, y, r: baseR,
      vx, vy,
      hit: false,
      bornAt: animate ? now() : 0,
      growMs: 6000,
      spawnScale,
      tx: x, ty: y
    });
  }

  function findSpawnPosition(rEff){
    const minY = ui.headerH;
    const tries = 300;
    for (let t = 0; t < tries; t++) {
      const x = rand(rEff, W - rEff);
      const y = rand(minY + rEff, H - rEff);
      let ok = true;
      for (const b of balls) {
        const rr = b.r * currentScale(b);
        const dx = x - b.x, dy = y - b.y;
        if (dx*dx + dy*dy < (rEff + rr) * (rEff + rr)) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return {
      x: clamp(W/2, rEff, W - rEff),
      y: clamp((H + minY)/2, minY + rEff, H - rEff)
    };
  }

  function buildBalls(){
    balls=[]; currentMax=10;
    for(let n=2;n<=10;n++) addBall(n, false);
  }

  function expandAfterPrimeClick(){
    if(currentMax>=MAX_N) return;
    const nextP = nextPrimeAbove(currentMax);
    const cap = nextP<=MAX_N ? nextP : MAX_N;
    for(let n=currentMax+1; n<=cap; n++) addBall(n, true);
    currentMax = cap;
  }

  function start(){
    running=true; startedAt=now(); penalty=0; wrongClicks=0; finishedTime=null;
    winMode = false;
  }

  function resetToStartState(){
    running=false; startedAt=0; penalty=0; wrongClicks=0; finishedTime=null;
    evenFlashUntil=0; threeFlashUntil=0;
    effects.length=0;
    winMode=false;
    buildBalls();
  }

  function win(){
    running=false;
    finishedTime = (now()-startedAt)/1000 + penalty;

    // enter win layout mode: freeze motion and animate into sorted grid
    winMode = true;
    winStartedAt = now();

    // normalize size (stop spawn scaling)
    for (const b of balls){ b.bornAt = 0; b.spawnScale = 1; }

    // compute grid & targets
    computeWinLayout();
		
		// Grow targets: diameter = W/16 => radius = W/32
		const targetR = Math.max(8, Math.floor(W / 32));
		for (const b of balls) b.rTarget = targetR;

    // stop motion so they don't keep bouncing
    for (const b of balls){ b.vx = 0; b.vy = 0; }
  }

  function computeWinLayout(){
    // sort ascending by n
    const sorted = [...balls].sort((a,b)=>a.n-b.n);

    // grid metrics
    const cols = 10;
    const marginX = Math.max(10, W*0.02);
    const marginTop = Math.max(10, ui.headerH + 12);
    const reservedBottom = Math.max(80, H*0.12); // space for "You Win!" message
    const availW = W - marginX*2;
    const availH = H - marginTop - reservedBottom;

		// const r = sorted.length ? sorted[0].r : 18;
		const r = Math.max(8, Math.floor(W / 32)); // target radius during win layout


    // choose cell sizes that fit
    const cellW = Math.max(r*2.6, Math.floor(availW / cols));
    const rows = Math.ceil(sorted.length / cols);
    const cellH = Math.max(r*2.6, Math.floor(availH / rows));

    // center grid horizontally; place vertically starting at marginTop
    const gridW = cellW * cols;
    const left = Math.floor((W - gridW)/2);
    const top = marginTop;
    const bottom = top + rows*cellH;

    grid = { cols, rows, cellW, cellH, top, left, bottom };

    // assign target centers (tx, ty)
    for (let i=0;i<sorted.length;i++){
      const c = i % cols;
      const rIdx = Math.floor(i / cols);
      const cx = left + c*cellW + cellW/2;
      const cy = top  + rIdx*cellH + cellH/2;
      sorted[i].tx = cx;
      sorted[i].ty = cy;
    }
  }

  // single combined hint (acts like pressing 2 and 3 together, one 5s penalty)
  function bothHints(){
    if (!running) return;
    const t = now();
    evenFlashUntil  = t + 5000; // 5s
    threeFlashUntil = t + 5000; // 5s
    penalty += 5;               // single 5s penalty
  }

	// --- GCF helpers ---
	function gcd(a, b) {
		a = Math.abs(a); b = Math.abs(b);
		while (b) { const t = b; b = a % b; a = t; }
		return a;
	}

	function pickCompositePairPreferringCommonFactor() {
		const pool = balls.filter(b => b.n > 1 && !isPrime(b.n) && !b.hit);
		if (pool.length < 2) return null;

		const withCommon = [];
		const allPairs = [];

		for (let i = 0; i < pool.length; i++) {
		  for (let j = i + 1; j < pool.length; j++) {
		    const A = pool[i], B = pool[j];
		    const g = gcd(A.n, B.n);
		    const pair = [A, B, g];
		    allPairs.push(pair);
		    if (g > 1) withCommon.push(pair);
		  }
		}
		const pick = (arr) => arr[(Math.random() * arr.length) | 0];
		return (withCommon.length ? pick(withCommon) : pick(allPairs));
	}

	function startGcf(){
		if (winMode || gcfActive || !running) return;
		const trip = pickCompositePairPreferringCommonFactor();
		if (!trip) return;
		const [a, b, g] = trip;
		gcfPair = { a, b, g };
		pauseStartedAt = now();      // freeze displayed clock
		gcfActive = true;

		openGcfModal();
	}

	function lockGcfNumbers(){
		if (!gcfPair) return;
		// put these two at their final win grid spots and freeze forever
		computeWinLayout();                // gives each ball tx,ty for the final grid
		for (const b of [gcfPair.a, gcfPair.b]) {
		  b.bornAt = 0; b.spawnScale = 1;
		  b.vx = 0; b.vy = 0;
		  b.hit = true;                    // our engine treats 'hit' as immobile
		  b.locked = true;           // << make background dark gray

		  if (typeof b.tx !== "number" || typeof b.ty !== "number") computeWinLayout();
		  b.x = b.tx; b.y = b.ty;
		  if (b.rTarget) b.r = b.rTarget;  // match win radius if present
		}
		gcfPair = null;
	}

	function closeGcfModal(){
		if (gcfDom && gcfDom.parentNode) gcfDom.parentNode.removeChild(gcfDom);
		gcfDom = null;
		try { window.speechSynthesis.cancel(); } catch(e){}
		if (pauseStartedAt) {                      // remove paused time from the clock
		  startedAt += (now() - pauseStartedAt);
		  pauseStartedAt = 0;
		}
		gcfActive = false;
	}


	function openGcfModal(){
		const a = gcfPair.a.n, b = gcfPair.b.n;
		const maxPossible = Math.min(a, b);

		// overlay
		const overlay = document.createElement("div");
		overlay.style.cssText = `
		  position:fixed; inset:0; z-index:9999;
		  background:rgba(0,0,0,.38);
		  display:flex; align-items:center; justify-content:center;
		  font-family: system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#e6eefb;
		`;

		// panel
		const panel = document.createElement("div");
		panel.style.cssText = `
		  background:#0f1620; border:1px solid #304156; border-radius:16px;
		  width:min(680px, 92vw); max-width:92vw; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,.45);
		`;

		// title
		const title = document.createElement("div");
		title.textContent = `GCF(${a}, ${b})`;
		title.style.cssText = `font-weight:900; font-size:clamp(22px,5.5vw,36px); margin-bottom:14px; color:#ffd400;`;

		// row with input + cancel
		const row = document.createElement("div");
		row.style.cssText = `display:flex; gap:8px; align-items:center; margin:8px 0 14px;`;

		const input = document.createElement("input");
		input.type = "number";
		input.placeholder = "Type the greatest common factor…";
		input.autofocus = true;
		input.style.cssText = `
		  flex:1; font-size:18px; padding:10px 12px; border-radius:12px;
		  border:1px solid #3a4a60; background:#ffffff; color:#000000; outline:none;
		`;

		const cancelBtn = document.createElement("button");
		cancelBtn.textContent = "Cancel";
		cancelBtn.style.cssText = `
		  padding:10px 14px; border-radius:12px; border:1px solid #3a4a60;
		  background:#2a3445; color:#e6eefb; cursor:pointer;
		`;

		// help (scrollable) + TTS
		const helpWrap = document.createElement("div");
		helpWrap.style.cssText = `
		  margin-top:10px; border:1px solid #2b394d; border-radius:12px; overflow:hidden;
		`;
		const helpHead = document.createElement("div");
		helpHead.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:#111a24;`;
		const helpTitle = document.createElement("div");
		helpTitle.textContent = "How to find the GCF";
		helpTitle.style.cssText = `font-weight:700;`;
		const speakBtn = document.createElement("button");
		speakBtn.textContent = "🔊";
		speakBtn.title = "Read aloud";
		speakBtn.style.cssText = `
		  width:36px; height:36px; border-radius:10px; border:1px solid #3a4a60;
		  background:#1c2532; color:#e6eefb; cursor:pointer; font-size:18px; line-height:1;
		`;
		const helpBody = document.createElement("div");
		helpBody.style.cssText = `max-height:28vh; overflow:auto; padding:10px 12px; background:#0b121b; line-height:1.4; color:#cfe2ff;`;
		helpBody.innerHTML = `
			<p>To find the Greatest Common Factor (GCF):</p>
			<p>List the factors of each number. The biggest number they both have is the GCF.</p>
			<p>Example: Factors of 8 are 1, 2, 4, 8. Factors of 12 are 1, 2, 3, 4, 6, 12. The biggest they both have is <b>4</b>.</p>
		`;

		helpHead.append(helpTitle, speakBtn);
		helpWrap.append(helpHead, helpBody);

		// assemble
		row.append(input, cancelBtn);
		panel.append(title, row, helpWrap);
		overlay.append(panel);
		document.body.appendChild(overlay);
		gcfDom = overlay;

		// focus management: keep focus on the input
		const refocus = () => { if (gcfActive) setTimeout(() => input.focus(), 0); };
		input.focus();
		input.addEventListener("blur", refocus);
		overlay.addEventListener("mousedown", refocus);

		// TTS
		speakBtn.onclick = () => {
		  try {
		    window.speechSynthesis.cancel();
		    const u = new SpeechSynthesisUtterance(helpBody.textContent || "");
		    u.rate = 1.0; u.pitch = 1.0;
		    window.speechSynthesis.speak(u);
		  } catch(e){}
		};

		// cancel
		cancelBtn.onclick = () => { closeGcfModal(); };

		// ESC closes; otherwise keep typing in the input
		overlay.addEventListener("keydown", (e) => {
		  if (e.key === "Escape") { e.preventDefault(); cancelBtn.click(); }
		});

		// check on every keystroke, no submit button needed
		function check() {
		  const raw = (input.value || "").trim();
		  if (!raw) {
		    input.style.color = "#000000";
		    input.style.borderColor = "#3a4a60";
		    input.style.background = "#ffffff";
		    return;
		  }
		  const v = parseInt(raw, 10);
		  if (!Number.isFinite(v)) return;

		  const tooBig = v > maxPossible;
		  input.style.color = tooBig ? "red" : "#000000";

		  if (v === gcfPair.g) {
		    // success highlight, then lock & close
		    input.style.borderColor = "#2e7d32";
		    input.style.background = "#cfead2";
		    cancelBtn.disabled = true; speakBtn.disabled = true;

				// success highlight, then brief message → return to game
				input.style.borderColor = "#2e7d32";
				input.style.background = "#cfead2";
				cancelBtn.disabled = true; speakBtn.disabled = true;

				const g = gcfPair.g;
				let str = showGcfResultMessage(g, a, b, () => {
					lockGcfNumbers();
					closeGcfModal();

					window.speechSynthesis.speak(new SpeechSynthesisUtterance(str));
				});
		  }
		}
		input.addEventListener("input", check);
	}

	function showGcfResultMessage(g, a, b, onDone) {
		const layer = document.createElement("div");
		layer.style.cssText = `
		  position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center;
		  pointer-events:none;
		`;
		const card = document.createElement("div");
		card.style.cssText = `
		  background:#0f1620; color:#e6eefb; border:1px solid #304156; border-radius:14px;
		  padding:14px 18px; font:600 18px/1.3 system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
		  box-shadow:0 10px 30px rgba(0,0,0,.45);
		`;
		card.textContent = `${g} is the greatest common factor of ${a} and ${b}.`;
		layer.append(card);
		document.body.append(layer);
		setTimeout(() => { layer.remove(); onDone && onDone(); }, 2000);
		return card.textContent;
	}

  // input
  canvas.addEventListener("pointerdown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left), y = (e.clientY - rect.top);

    // header buttons
    for (const b of ui.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        b.onClick();
        return;
      }
    }

    // center Start button (when not running and not arranging)
    if (!running && !winMode) {
      const btn = centerButtonRect();
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        resetToStartState();
        start();
        return;
      }
    }

    if (!running || winMode) return; // disable clicks during win layout

    // --- BALL CLICK DETECTION WITH PRIME HALO ---
    const HALO = 2.5; // allow clicks within 0.5×radius outside prime's edge

		// edge-based prime preference: nearest prime within HALO, else exact hit
		let clickedIdx = -1;        // topmost exact hit on any ball
		let hitPrimeIdx = -1;       // decided prime hit (may be halo)
		let bestPrimeDist2 = Infinity;

		for (let i = balls.length - 1; i >= 0; i--) {
			const b = balls[i];
			if (b.hit) continue;

			const rr = b.r * currentScale(b);
			const dx = x - b.x, dy = y - b.y;
			const d2 = dx * dx + dy * dy;

			// record topmost exact hit
			if (clickedIdx === -1 && d2 <= rr * rr) clickedIdx = i;

			// prime halo: allow up to (HALO - 1)×radius outside the edge (d <= rr*HALO)
			if (isPrime(b.n)) {
				const haloR = rr * HALO;
				if (d2 <= haloR * haloR && d2 < bestPrimeDist2) {
				  bestPrimeDist2 = d2;
				  hitPrimeIdx = i; // nearest prime inside halo
				}
			}
		}

		// prefer a directly clicked prime over a different halo prime
		if (clickedIdx !== -1 && isPrime(balls[clickedIdx].n)) {
			hitPrimeIdx = clickedIdx;
		}

    if (hitPrimeIdx !== -1) {
      const b = balls[hitPrimeIdx];
      const rr = b.r * currentScale(b);
      // spiral effect
      effects.push({ x: b.x, y: b.y, start: now(), duration: 4000, startR: rr * 6.0, turns: 9.0 });
      b.hit = true;

			const lastPrimeNow = (currentMax === MAX_N) && !balls.some(v => isPrime(v.n) && !v.hit && v !== b);

			if (!lastPrimeNow) {
				const s = primeSounds[(Math.random() * primeSounds.length) | 0];
				s.currentTime = 0;
				s.play();
			}

      expandAfterPrimeClick();
      if (currentMax === MAX_N) {
        const anyLeft = balls.some(v => isPrime(v.n) && !v.hit);
        if (!anyLeft) {
          winSound.currentTime = 0;
          winSound.play();
          win();
        }
      }
      return;
    }

    // No prime hit: only penalize if a ball was actually clicked.
    if (clickedIdx === -1) return;
    penalty += 2; wrongClicks += 1;
  });

  function update(){
		if (gcfActive) return;  // hard pause while GCF modal is open

    const minY = ui.headerH;

    if (!winMode) {
      for (const b of balls){
        if (b.hit) continue;
        b.x += b.vx; b.y += b.vy;

        const rEff = b.r * currentScale(b);
        if (b.x < rEff){ b.x = rEff;       b.vx = Math.abs(b.vx); }
        if (b.x > W - rEff){ b.x = W - rEff; b.vx = -Math.abs(b.vx); }
        if (b.y < minY + rEff){ b.y = minY + rEff; b.vy = Math.abs(b.vy); }
        if (b.y > H - rEff){ b.y = H - rEff; b.vy = -Math.abs(b.vy); }

        b.vx *= DAMP_PER_FRAME;
        b.vy *= DAMP_PER_FRAME;
        softClampSpeed(b);
      }

      handleCollisions();

      for (const b of balls){
        if (b.hit) continue;
        softClampSpeed(b);
      }

    } else {
      // arrange into grid while win sound plays
      const t = now();
      const elapsed = (t - winStartedAt) / 1000;
      const smoothing = 1 - Math.pow(0.0005, 1/60); // ~fast ease-in
      for (const b of balls){
				// approach target
				b.x = b.x + (b.tx - b.x) * smoothing;
				b.y = b.y + (b.ty - b.y) * smoothing;

				// grow radius toward target
				if (b.rTarget) b.r = b.r + (b.rTarget - b.r) * smoothing;

      }
      // keep effects alive a little longer if any
    }

    // clean up finished effects
    const t = now();
    for (let i = effects.length - 1; i >= 0; i--){
      if (t - effects[i].start >= effects[i].duration) effects.splice(i, 1);
    }
  }

  function handleCollisions(){
    if (winMode) return; // no collisions while arranging

    const n = balls.length;

    // A) moving vs moving
    for (let i = 0; i < n; i++){
      const bi = balls[i]; if (bi.hit) continue;
      const ri = bi.r * currentScale(bi);

      for (let j = i + 1; j < n; j++){
        const bj = balls[j]; if (bj.hit) continue;
        const rj = bj.r * currentScale(bj);

        let dx = bj.x - bi.x, dy = bj.y - bi.y;
        let dist2 = dx*dx + dy*dy;
        const rr = ri + rj;
        if (dist2 >= rr*rr) continue;

        let dist = Math.sqrt(dist2);
        if (!isFinite(dist) || dist === 0){ dist = 1e-6; dx = rr; dy = 0; }

        let nx = dx / dist, ny = dy / dist;
        const overlap = rr - dist;

        // separate
        const push = overlap * 0.5;
        bi.x -= nx * push; bi.y -= ny * push;
        bj.x += nx * push; bj.y += ny * push;

        // impulse
        const rvx = bi.vx - bj.vx, rvy = bi.vy - bj.vy;
        const velN = rvx*nx + rvy*ny;
        if (velN > 0) continue; // already separating

        const e = 0.92; // slightly inelastic
        const jImp = -(1 + e) * velN / 2; // equal masses
        const ix = jImp * nx, iy = jImp * ny;

        bi.vx += -ix; bi.vy += -iy;
        bj.vx +=  ix; bj.vy +=  iy;
      }
    }

    // B) moving vs static primes (clicked primes are solid bumpers)
    for (let i = 0; i < n; i++){
      const m = balls[i]; if (m.hit) continue;
      const rm = m.r * currentScale(m);

      for (let j = 0; j < n; j++){
        const p = balls[j];
        if (!(p.hit && isPrime(p.n))) continue;
        const rp = p.r * currentScale(p);

        let dx = m.x - p.x, dy = m.y - p.y;
        let dist2 = dx*dx + dy*dy;
        const rr = rm + rp;
        if (dist2 >= rr*rr) continue;

        let dist = Math.sqrt(dist2);
        if (!isFinite(dist) || dist === 0){ dist = 1e-6; dx = rr; dy = 0; }

        let nx = dx / dist, ny = dy / dist;
        const overlap = rr - dist;

        // push out fully
        m.x += nx * overlap; m.y += ny * overlap;

        // reflect with a touch of loss
        const vN = m.vx*nx + m.vy*ny;
        if (vN < 0){
          const e = 0.92;
          const k = (1 + e);
          m.vx = m.vx - k * vN * nx * 2;
          m.vy = m.vy - k * vN * ny * 2;
        }
      }
    }
  }

  function drawHeader(){
    ctx.fillStyle="#0f1620"; ctx.fillRect(0,0,W,ui.headerH);

    // header buttons
    for(const b of ui.buttons){
      const r=Math.min(12,b.h/3);
      ctx.fillStyle="#1c2532"; roundRect(b.x,b.y,b.w,b.h,r); ctx.fill();
      ctx.strokeStyle="#3a4a60"; ctx.lineWidth=2; roundRect(b.x,b.y,b.w,b.h,r); ctx.stroke();
      ctx.font=`700 ${Math.floor(ui.fontSize*0.95)}px ${ui.fontFamily}`; ctx.fillStyle="#e6eefb";
      const tw=ctx.measureText(b.label).width; ctx.fillText(b.label,b.x+(b.w-tw)/2,b.y+b.h*0.68);
    }

    // progress
    const totalPrimes = balls.reduce((a,b)=>a+(isPrime(b.n)?1:0),0);
    const clickedPrimes = balls.reduce((a,b)=>a+(isPrime(b.n)&&b.hit?1:0),0);
    const progress = `${clickedPrimes} out of ${totalPrimes}`;
    const rightEdge = ui.buttons.reduce((m,b)=>Math.max(m, b.x+b.w), 0);
    ctx.font=`700 ${ui.fontSize}px ${ui.fontFamily}`; ctx.fillStyle="#e6f0ff";
    ctx.fillText(progress, rightEdge + ui.btnPad*2, ui.headerH - ui.btnPad);

    // timer + wrong
    ctx.font=`700 ${ui.fontSize}px ${ui.fontFamily}`;
    ctx.fillStyle=running?"#9df29d":"#ffd27d";
    const tStr=`Time: ${formatTime(getTime())}  |  Wrong: ${wrongClicks}`;
    const tw=ctx.measureText(tStr).width; ctx.fillText(tStr, W-tw-ui.btnPad, ui.headerH-ui.btnPad);
  }

  function drawBalls(){
    const t = now();
    const evenActive = t < evenFlashUntil;
    const threeActive = t < threeFlashUntil;

    ctx.lineWidth=2;
    for(const b of balls){
			// colors
			let fill="rgba(120,30,20,0.82)", stroke="#6a86a9", text="#dfe9f7";
			if (b.locked) {                      // << locked background
				fill = "#3a3a3a";                  // dark gray
				stroke = "#585858";
				// (text stays light for contrast)
			} else if (evenActive && b.n%2===0){
				fill="#2d6bff"; stroke="#1b46a8"; text="#000000";
			} else if (threeActive && b.n%3===0){
				fill="#2bff2b"; stroke="#a31313"; text="#ffffff";
			} else if (b.hit && isPrime(b.n)){
				fill="#ffd400"; stroke="#b08900"; text="#000000";
			}


      const scale = currentScale(b);
      const rr = b.r*scale;

      ctx.beginPath(); ctx.arc(b.x,b.y,rr,0,Math.PI*2); ctx.closePath();
      ctx.fillStyle=fill; ctx.fill(); ctx.strokeStyle=stroke; ctx.stroke();

      const fs=Math.max(10,Math.floor(rr*0.9));
      ctx.fillStyle=text; ctx.font=`700 ${fs}px ${ui.fontFamily}`;
      const s=String(b.n), tw=ctx.measureText(s).width;
      ctx.fillText(s, b.x-tw/2, b.y+fs*0.35);
    }

    // effects
    drawEffects();
  }

  function drawEffects(){
    const t=now();
    for(const fx of effects){
      const p = clamp((t - fx.start)/fx.duration, 0, 1);
      const fade = 1 - p;
      const R = fx.startR * (1 - p);
      const turns = fx.turns;
      const maxTheta = turns * Math.PI * 2;
      const steps = 140;
      ctx.save();
      ctx.beginPath();
      for(let i=0;i<=steps;i++){
        const th = (i/steps) * maxTheta;
        const r = (R * th / maxTheta);
        const x = fx.x + r * Math.cos(th);
        const y = fx.y + r * Math.sin(th);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.strokeStyle=`rgba(255,212,0,${0.85*fade})`;
      ctx.lineWidth = Math.max(1.5, 3*fade);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawWinOverlay(){
    if (!winMode) return;

    // subtle dim behind the grid
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, ui.headerH, W, H-ui.headerH);
    ctx.restore();

    // "You Win!" message under the grid area
    const msg = "You Win!";
    const y = Math.min(H - 20, grid.bottom + Math.max(28, ui.fontSize*1.4));
    ctx.save();
    ctx.font = `900 ${Math.max(28, Math.min(W,H)*0.06)}px ${ui.fontFamily}`;
    ctx.fillStyle = "#ffd400";
    const tw = ctx.measureText(msg).width;
    const x = (W - tw) / 2;
    // soft shadow for pop
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fillText(msg, x, y);
    ctx.restore();
  }

  // drawing helpers
  function roundRect(x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  function currentScale(b){
    if(b.bornAt===0) return 1.0;
    const t = clamp((now()-b.bornAt)/b.growMs, 0, 1);
    const eased = easeOutCubic(t);
    return b.spawnScale - (b.spawnScale - 1.0) * eased;
  }

	function getTime(){
		if (startedAt === 0) return 0;
		if (finishedTime != null) return finishedTime;
		const tNow = pauseStartedAt ? pauseStartedAt : now(); // frozen while paused
		return (tNow - startedAt) / 1000 + penalty;
	}

  const formatTime=(s)=>(Math.round(s*10)/10).toFixed(1)+"s";

  function centerButtonRect(){
    const w=Math.min(260, Math.max(180, W*0.28));
    const h=Math.min(90, Math.max(64, H*0.12));
    return { x:(W-w)/2, y:(H-h)/2, w, h, r:Math.min(16, h/3) };
  }

  function drawCenterStart(){
    if(running || winMode) return;
    const {x,y,w,h,r}=centerButtonRect();
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,0.25)"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#2b7cff"; roundRect(x,y,w,h,r); ctx.fill();
    ctx.strokeStyle="#7fb1ff"; ctx.lineWidth=2; roundRect(x,y,w,h,r); ctx.stroke();
    ctx.fillStyle="#061120";
    const label = "Start";
    ctx.font=`800 ${Math.max(18,Math.min(W,H)*0.04)}px ${ui.fontFamily}`;
    const tw=ctx.measureText(label).width;
    ctx.fillText(label, x+(w-tw)/2, y+h*0.65);
    ctx.restore();
  }

	function drawBackground() {
		if (!bkgReady) return;
		// Stretched to the canvas’ current size
		ctx.drawImage(bkg, 0, 0, W, H);
	}

	function loop(){
		update();
		ctx.clearRect(0,0,W,H);
		drawBackground();          // <— NEW
		drawBalls();
		drawHeader();
		drawCenterStart();
		drawWinOverlay();
		requestAnimationFrame(loop);
	}

	// Spacebar triggers the GCF action (like clicking the GCF button)
	window.addEventListener('keydown', (e) => {
		if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
		  if (gcfActive) return; // don't relaunch while modal is open
		  const ae = document.activeElement;
		  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
		  e.preventDefault();
		  if (typeof startGcf === 'function') {
		    if (running) startGcf();
		  } else if (window.ui && Array.isArray(ui.buttons)) {
		    const btn = ui.buttons.find(b => /gcf/i.test(b.label || b.text || ""));
		    if (btn && typeof btn.onClick === 'function') btn.onClick();
		  }
		}
	});


  // init
  window.addEventListener("resize", resize, {passive:true});
  resize();
  buildBalls();
  loop();
})();

