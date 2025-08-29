/* =========================================================
   
========================================================= */

const CHAIN_ID_HEX = "0x58"; // 88
const RPC_URL      = "https://rpc.viction.xyz";
const EXPLORER     = "https://www.vicscan.xyz";

const VIN_ADDR   = "0x941F63807401efCE8afe3C9d88d368bAA287Fac4";
const LOTO_ADDR  = "0xD7747C14D450b47A5eFEE6d70Aa61EA7fDd11CdB";

/* ===== ABI  ===== */
const VIN_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];
const LOTO_ABI = [
  // views & constants
  "function minBet() view returns (uint256)",
  "function LO_DRAWS() view returns (uint256)",
  "function LO_PAYOUT_X() view returns (uint256)",
  "function DE_PAYOUT_X() view returns (uint256)",
  "function contractBalance() view returns (uint256)",

  // core
  "function betLo(uint8[] numbers, uint256[] stakes) external",
  "function betDe(uint8[] numbers, uint256[] stakes) external",

  // events
  "event BetLoPlayed(address indexed player, uint8[] numbers, uint256[] stakes, uint256 totalStake)",
  "event BetLoSettled(address indexed player, uint8[] draws, uint256 grossPayout, uint256 netDiff)",
  "event BetDePlayed(address indexed player, uint8[] numbers, uint256[] stakes, uint256 totalStake)",
  "event BetDeSettled(address indexed player, uint8 draw, uint256 grossPayout, uint256 netDiff)",

  // custom errors
  "error PausedError()",
  "error InvalidInput()",
  "error DuplicateNumber()",
  "error BelowMinBet()",
  "error InsufficientAllowance()",
  "error InsufficientLiquidity()"
];

/* ===== State ===== */
let provider, signer, user, vin, lotto;
let vinDecimals = 18;           // sẽ đọc thật từ VIN.decimals()
let minBetWei   = 10n ** 15n;   // fallback 0.001 VIN
let LO_DRAWS = 27n, LO_X = 4n, DE_X = 70n; // sẽ đọc thật từ HĐ

/* ===== DOM helpers ===== */
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
function toast(msg){ const el=$("#status-msg"); if(el) el.textContent=msg; else console.log(msg); }

const fmtNumber = (x, d=6) => Number(x).toLocaleString(undefined,{maximumFractionDigits:d});
const fmtVIN    = (wei) => ethers.formatUnits(wei, vinDecimals);
const parseVIN  = (v)   => ethers.parseUnits(String(v ?? "0"), vinDecimals);

/* ===== Gas overrides ===== */
async function getFastOverrides() {
  const fee = await provider.getFeeData();
  const ov = {};
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    let prio = fee.maxPriorityFeePerGas * 2n;
    if (prio < ethers.parseUnits("1", "gwei")) prio = ethers.parseUnits("1", "gwei");
    let max  = (fee.maxFeePerGas * 12n) / 10n;
    if (max <= prio) max = prio + ethers.parseUnits("1", "gwei");
    ov.maxPriorityFeePerGas = prio;
    ov.maxFeePerGas         = max;
  } else if (fee.gasPrice) {
    ov.gasPrice = (fee.gasPrice * 125n) / 100n;
  } else {
    ov.gasPrice = ethers.parseUnits("1", "gwei");
  }
  return ov;
}

/* ===== Chain / Wallet ===== */
async function ensureChain(){
  const eth = window.ethereum;
  if(!eth) throw new Error("MetaMask not found.");
  const cid = await eth.request({method:"eth_chainId"});
  if (cid !== CHAIN_ID_HEX){
    try{
      await eth.request({method:"wallet_switchEthereumChain", params:[{chainId:CHAIN_ID_HEX}]});
    }catch(e){
      if(e.code === 4902){
        await eth.request({
          method:"wallet_addEthereumChain",
          params:[{
            chainId: CHAIN_ID_HEX,
            chainName: "Viction",
            nativeCurrency: {name:"VIC", symbol:"VIC", decimals:18},
            rpcUrls:[RPC_URL],
            blockExplorerUrls:[EXPLORER]
          }]
        });
      } else { throw e; }
    }
  }
}

async function connectWallet(){
  try{
    await ensureChain();
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer = await provider.getSigner();
    user   = await signer.getAddress();
    $("#wallet-address")?.replaceChildren(document.createTextNode(user));
    vin   = new ethers.Contract(VIN_ADDR,  VIN_ABI,  signer);
    lotto = new ethers.Contract(LOTO_ADDR, LOTO_ABI, signer);

    // Read VIN decimals & game params
    try {
      vinDecimals = await vin.decimals();
      const [m, d, lx, dx] = await Promise.all([
        lotto.minBet(),
        lotto.LO_DRAWS?.().catch(()=>LO_DRAWS),
        lotto.LO_PAYOUT_X?.().catch(()=>LO_X),
        lotto.DE_PAYOUT_X?.().catch(()=>DE_X)
      ]);
      minBetWei = m ?? minBetWei;
      LO_DRAWS  = d ?? LO_DRAWS;
      LO_X      = lx ?? LO_X;
      DE_X      = dx ?? DE_X;
    } catch {}

    // update placeholders theo minBet
    $$(".stakes").forEach(inp=>{
      inp.min = Number(fmtVIN(minBetWei));
      if(!inp.placeholder || /0\.001/i.test(inp.placeholder)){
        inp.placeholder = `≥ ${fmtVIN(minBetWei)} VIN`;
      }
    });

    toast("Wallet connected.");
    await refreshBalances();
  }catch(e){
    console.error(e);
    toast("Connect failed. Ensure MetaMask is on Viction (VIC).");
  }
}

async function refreshBalances(){
  try{
    if(!provider || !user) return;
    const vic = await provider.getBalance(user);
    $("#vic-balance") && ($("#vic-balance").textContent = `${fmtNumber(ethers.formatEther(vic),4)}`);
    const vUser = await vin.balanceOf(user);
    $("#vin-balance") && ($("#vin-balance").textContent = `${fmtNumber(fmtVIN(vUser),6)}`);
    const vPool = await vin.balanceOf(LOTO_ADDR);
    $("#vin-pool") && ($("#vin-pool").textContent       = `${fmtNumber(fmtVIN(vPool),2)}`);
  }catch(e){
    console.error(e);
    toast("Failed to refresh balances.");
  }
}

/* ===== Bet rows ===== */
const MAX_ROWS = 100;
function bindRowEvents(row){
  const num=row.querySelector(".numbers");
  const amt=row.querySelector(".stakes");
  const bAdd=row.querySelector(".add-row-btn");
  const bClr=row.querySelector(".clear-btn");
  const bRem=row.querySelector(".remove-row-btn");
  const recalc=()=>calcTotal();
  num?.addEventListener("input",recalc);
  amt?.addEventListener("input",recalc);
  bAdd?.addEventListener("click",()=>addRow());
  bClr?.addEventListener("click",()=>{ if(num) num.value=""; if(amt) amt.value=""; recalc(); });
  bRem?.addEventListener("click",()=>{
    const all=$$("#bet-numbers-container .bet-row");
    if(all.length<=1) return;
    row.remove();
    updateRemoveButtons();
    recalc();
  });
}
function updateRemoveButtons(){
  const rows=$$("#bet-numbers-container .bet-row");
  const dis = rows.length<=1;
  rows.forEach(r=>{ const b=r.querySelector(".remove-row-btn"); if(b) b.disabled=dis; });
}
function addRow(){
  const rows=$$("#bet-numbers-container .bet-row");
  if(rows.length>=MAX_ROWS){ toast(`Maximum ${MAX_ROWS} rows.`); return; }
  const tpl=$("#bet-row-template");
  const node=tpl.content.firstElementChild.cloneNode(true);
  $("#bet-numbers-container").appendChild(node);
  bindRowEvents(node);
  updateRemoveButtons();
}
function initRows(){
  const first=$("#bet-numbers-container .bet-row");
  if(first) bindRowEvents(first);
  updateRemoveButtons();
  calcTotal();
}

/* ===== Collect & totals ===== */
function collectBets(){
  const rows=$$("#bet-numbers-container .bet-row");
  const numbers=[], stakes=[];
  const seen=new Set();
  for(const r of rows){
    const nEl=r.querySelector(".numbers");
    const aEl=r.querySelector(".stakes");
    const nRaw=(nEl?.value||"").trim();
    const aRaw=(aEl?.value||"").trim();
    if(!nRaw && !aRaw) continue;

    const n=Number(nRaw);
    if(!Number.isInteger(n) || n<0 || n>99) throw new Error("Invalid number — enter 00–99.");
    if(seen.has(n)) throw new Error("Duplicate number — each number must be unique.");
    seen.add(n);

    if(!aRaw || Number(aRaw)<=0) throw new Error("Invalid stake amount.");
    const stakeWei = parseVIN(aRaw);
    if (stakeWei < minBetWei) throw new Error(`Each stake must be ≥ ${fmtVIN(minBetWei)} VIN.`);
    numbers.push(n);
    stakes.push(stakeWei);
  }
  if(numbers.length===0) throw new Error("Please enter at least one bet.");
  if(numbers.length>100) throw new Error("Maximum 100 numbers per bet.");
  return {numbers, stakes};
}
function calcTotal(){
  const rows=$$("#bet-numbers-container .bet-row");
  let total=0n;
  for(const r of rows){
    const aEl=r.querySelector(".stakes");
    const aRaw=(aEl?.value||"").trim();
    if(aRaw && Number(aRaw)>0) total += parseVIN(aRaw);
  }
  $("#total-stake") && ($("#total-stake").textContent = fmtNumber(fmtVIN(total)));
  return total;
}

/* ===== Repeat / Double / Half ===== */
let lastBets = null;
function applyRepeat(){
  if(!lastBets) return;
  $("#bet-numbers-container").innerHTML="";
  for(let i=0;i<lastBets.numbers.length;i++){
    const node=$("#bet-row-template").content.firstElementChild.cloneNode(true);
    node.querySelector(".numbers").value = String(lastBets.numbers[i]).padStart(2,"0");
    node.querySelector(".stakes").value  = lastBets.stakes[i];
    $("#bet-numbers-container").appendChild(node);
    bindRowEvents(node);
  }
  updateRemoveButtons();
  calcTotal();
}
function applyDouble(){ $$("#bet-numbers-container .stakes").forEach(inp=>{const v=Number(inp.value||"0"); if(v>0) inp.value=String(v*2);}); calcTotal(); }
function applyHalf(){   $$("#bet-numbers-container .stakes").forEach(inp=>{const v=Number(inp.value||"0"); if(v>0) inp.value=String(v/2);}); calcTotal(); }

/* ===== Allowance ===== */
async function ensureAllowance(neededWei){
  const cur = await vin.allowance(user, LOTO_ADDR);
  if (cur >= neededWei) return;
  toast("Approving VIN...");
  const feeOv = await getFastOverrides();
  const tx = await vin.approve(LOTO_ADDR, neededWei, feeOv);
  toast(`Approve submitted: ${tx.hash}. Waiting...`);
  await tx.wait();
}

/* ===== Preflight thanh khoản (khớp HĐ) =====
   Lo: worst = LO_DRAWS * LO_PAYOUT_X * maxStake
   De: worst = DE_PAYOUT_X * maxStake
   HĐ: require(VIN.balanceOf(this) + totalStake >= worst)
*/
async function preflightLiquidity(stakes, betType){
  let total=0n, maxStake=0n;
  for(const s of stakes){ total+=s; if(s>maxStake) maxStake=s; }
  const pool = await vin.balanceOf(LOTO_ADDR);
  const worst = (betType === "matchup")
    ? (DE_X * maxStake)
    : (LO_DRAWS * LO_X * maxStake);
  if (pool + total < worst) {
    throw new Error(
      `Pool insufficient for worst-case payout. Need ≥ ${fmtNumber(fmtVIN(worst))} VIN (your total + pool is lower).`
    );
  }
}

/* ===== Decode revert  ===== */
function parseRevertMessage(e){
  try{
    const data = e?.data || e?.info?.error?.data || e?.error?.data;
    if(!data || typeof data!=="string") return null;
    const iface = new ethers.Interface(LOTO_ABI);
    const parsed = iface.parseError(data);
    if(!parsed) return null;
    switch(parsed.name){
      case "PausedError":           return "Game is currently paused.";
      case "InvalidInput":          return "Invalid input (check numbers & stakes).";
      case "DuplicateNumber":       return "Duplicate numbers are not allowed.";
      case "BelowMinBet":           return `Each stake must be ≥ ${fmtVIN(minBetWei)} VIN.`;
      case "InsufficientAllowance": return "Allowance is insufficient. Please approve enough VIN and try again.";
      case "InsufficientLiquidity": return "Contract pool cannot cover worst-case payout. Try lowering your max stake.";
      default: return `Reverted: ${parsed.name}`;
    }
  }catch{}
  return e?.shortMessage || e?.reason || e?.message || null;
}

/* ===== Đặt cược ===== */
async function placeBet(){
  try{
    if(!signer){ toast("Please connect your wallet first."); return; }
    const {numbers, stakes} = collectBets();

    // Lưu cho Repeat (stake dạng string VIN)
    lastBets = { numbers: numbers.slice(), stakes: stakes.map(bi=>fmtVIN(bi)) };

    let total=0n; for(const s of stakes) total+=s;
    if(total<=0n){ toast("Total stake must be > 0."); return; }

    const betType = document.querySelector('input[name="bet-type"]:checked')?.value || "lucky27";

    await preflightLiquidity(stakes, betType);
    await ensureAllowance(total);

    const method = (betType === "matchup") ? "betDe" : "betLo";
    toast("Sending bet transaction...");

    // Gas estimate + fast overrides (+20% buffer)
    const feeOv  = await getFastOverrides();
    let gasEst;
    try { gasEst = await lotto[method].estimateGas(numbers, stakes, feeOv); }
    catch { try { gasEst = await lotto[method].estimateGas(numbers, stakes); } catch {} }
    const tx = await lotto[method](numbers, stakes, {
      ...feeOv,
      ...(gasEst ? { gasLimit: (gasEst * 12n) / 10n } : {})
    });

    // 
    const pairs = numbers.map((n,i)=> `${String(n).padStart(2,"0")}: ${fmtNumber(fmtVIN(stakes[i]))} VIN`);
    $("#last-bet-numbers").textContent = pairs.join("; ");
    $("#last-bet-stake").textContent   = `${fmtNumber(fmtVIN(total))} VIN`;
    $("#last-bet-result").textContent  = "Waiting for confirmation...";
    $("#last-win-status").textContent  = "No win/loss yet";

    const rc = await tx.wait();

    // Parse logs 
    let win=false, resultText="";
    try{
      const iface = new ethers.Interface(LOTO_ABI);
      for(const log of rc.logs || []){
        try{
          const p = iface.parseLog(log);
          if(p?.name==="BetLoSettled"){
            const draws = p.args.draws.map(x=>Number(x));
            const gross = ethers.toBigInt(p.args.grossPayout);
            resultText = `Draws: ${draws.map(x=>String(x).padStart(2,"0")).join(", ")} | Payout: ${fmtNumber(fmtVIN(gross))} VIN`;
            win = (gross > 0n);
          }else if(p?.name==="BetDeSettled"){
            const draw  = Number(p.args.draw);
            const gross = ethers.toBigInt(p.args.grossPayout);
            resultText = `Draw: ${String(draw).padStart(2,"0")} | Payout: ${fmtNumber(fmtVIN(gross))} VIN`;
            win = (gross > 0n);
          }
        }catch{/* ignore */}
      }
    }catch(e){ console.warn("Parse logs failed:", e); }

    $("#last-bet-result").textContent = resultText || `Confirmed in block ${rc.blockNumber}.`;
    const winEl = $("#last-win-status");
    winEl.textContent = win ? "WIN" : "LOSE";
    winEl.classList.toggle("win",  win);
    winEl.classList.toggle("lose", !win);

    toast(`Bet confirmed. Tx: ${EXPLORER}/tx/${tx.hash}`);
    await refreshBalances();
  }catch(e){
    console.error(e);
    toast(parseRevertMessage(e) || "Bet failed.");
  }
}

/* ===== Lucky Picks (preview-only) ===== */
function randInt(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
function luckyGenerate(){
  const countEl = $("#lucky-count");
  const previewEl = $("#lucky-preview");
  if(!countEl || !previewEl) return;

  let n = Math.floor(Number(countEl.value || "0"));
  if (!Number.isFinite(n) || n < 1 || n > 99) {
    previewEl.textContent = "Please enter 1–99.";
    return;
  }

  const chosen = new Set();
  while(chosen.size < n){
    chosen.add(randInt(0,99));
  }
  const arr = [...chosen].sort((a,b)=>a-b);
  previewEl.textContent = arr.map(x=>String(x).padStart(2,"0")).join(", ");
}

/* ===== Decode (tx hash / raw event data) ===== */
function extractTxHash(input) {
  if (!input) return null;
  const m = String(input).match(/0x[0-9a-fA-F]{64}/);
  return m ? m[0] : null;
}
function autoResizeTextarea(el){
  if(!el) return;
  el.style.height="auto";
  el.style.height=(el.scrollHeight+4)+"px";
}
async function decodeEventData(){
  const elIn  = $("#decode-input");
  const elOut = $("#decode-output");
  if (!elIn || !elOut) return;

  try {
    const raw = (elIn.value || "").trim();
    if (!raw) throw new Error("Please paste data or a tx hash / link.");

    // A) TX HASH hoặc link VicScan
    const maybeHash = extractTxHash(raw);
    if (maybeHash && raw.length <= 200) {
      const ro = provider ?? new ethers.JsonRpcProvider(RPC_URL);
      const rc = await ro.getTransactionReceipt(maybeHash);
      if (!rc) throw new Error("Transaction not found. Please check the hash/link.");

      const iface = new ethers.Interface(LOTO_ABI);
      let played=null, settled=null;

      for (const log of rc.logs || []) {
        try {
          const p = iface.parseLog(log);
          if (!p) continue;
          if (p.name==="BetLoPlayed" || p.name==="BetDePlayed") played = p;
          if (p.name==="BetLoSettled"|| p.name==="BetDeSettled") settled = p;
        } catch {}
      }

      if (!played && !settled) {
        elOut.innerHTML = `<span class="muted">No LottoVIN bet events found in this transaction.</span>`;
        return;
      }

      let html = `<strong>Tx:</strong> <a href="${EXPLORER}/tx/${maybeHash}" target="_blank" rel="noopener">${maybeHash}</a><br/>`;

      if (played) {
        const nums   = Array.from(played.args.numbers).map(n => Number(n));
        const stakes = Array.from(played.args.stakes).map(bi => ethers.toBigInt(bi));
        const total  = ethers.toBigInt(played.args.totalStake);
        const pairs  = nums.map((n,i)=> `${String(n).padStart(2,"0")}: ${fmtNumber(fmtVIN(stakes[i]))} VIN`);
        html += `Bets: ${pairs.join("; ")}<br/>` +
                `Total Stake: ${fmtNumber(fmtVIN(total))} VIN<br/>`;
      } else {
        html += `<span class="muted">No "Played" event found in this tx.</span><br/>`;
      }

      if (settled) {
        if (settled.name === "BetLoSettled") {
          const draws  = Array.from(settled.args.draws).map(n => String(Number(n)).padStart(2,"0"));
          const payout = ethers.toBigInt(settled.args.grossPayout);
          html += `Draws: ${draws.join(", ")}<br/>` +
                  `Payout: ${fmtNumber(fmtVIN(payout))} VIN<br/>` +
                  `Outcome: ${payout>0n ? "WIN" : "LOSE"}`;
        } else {
          const d      = String(Number(settled.args.draw)).padStart(2,"0");
          const payout = ethers.toBigInt(settled.args.grossPayout);
          html += `Draw: ${d}<br/>` +
                  `Payout: ${fmtNumber(fmtVIN(payout))} VIN<br/>` +
                  `Outcome: ${payout>0n ? "WIN" : "LOSE"}`;
        }
      } else {
        html += `<span class="muted">No "Settled" event found in this tx (maybe a different tx).</span>`;
      }

      elOut.innerHTML = html;
      return;
    }

    // B) RAW HEX data 
    if (!raw.startsWith("0x")) throw new Error("Please paste hex data starting with 0x, or a tx hash / link.");
    const coder = ethers.AbiCoder.defaultAbiCoder();

    // Played: (uint8[] numbers, uint256[] stakes, uint256 totalStake)
    try {
      const [nums, stakes, total] = coder.decode(["uint8[]", "uint256[]", "uint256"], raw);
      const nArr = Array.from(nums).map(n => Number(n));
      const sArr = Array.from(stakes).map(bi => ethers.toBigInt(bi));
      const pairs = nArr.map((n,i)=> `${String(n).padStart(2,"0")}: ${fmtNumber(fmtVIN(sArr[i]))} VIN`);
      elOut.innerHTML =
        `<strong>Decoded (Played)</strong><br/>` +
        `Bets: ${pairs.join("; ")}<br/>` +
        `Total Stake: ${fmtNumber(fmtVIN(total))} VIN<br/>` +
        `<span class="muted">For draws & payout, paste Settled-event data or the tx hash.</span>`;
      return;
    } catch (_) {}

    // Lo Settled: (uint8[] draws, uint256 grossPayout, uint256 netDiff)
    try {
      const [draws, gross /*, net*/] = coder.decode(["uint8[]", "uint256", "uint256"], raw);
      const arr = Array.from(draws).map(n => String(Number(n)).padStart(2,"0"));
      const payout = ethers.toBigInt(gross);
      elOut.innerHTML =
        `<strong>Decoded (Lo Settled)</strong><br/>` +
        `Draws: ${arr.join(", ")}<br/>` +
        `Payout: ${fmtNumber(fmtVIN(payout))} VIN<br/>` +
        `Outcome: ${payout>0n ? "WIN" : "LOSE"}`;
      return;
    } catch (_) {}

    // De Settled: (uint8 draw, uint256 grossPayout, uint256 netDiff)
    try {
      const [draw, gross /*, net*/] = coder.decode(["uint8", "uint256", "uint256"], raw);
      const d = String(Number(draw)).padStart(2,"0");
      const payout = ethers.toBigInt(gross);
      elOut.innerHTML =
        `<strong>Decoded (De Settled)</strong><br/>` +
        `Draw: ${d}<br/>` +
        `Payout: ${fmtNumber(fmtVIN(payout))} VIN<br/>` +
        `Outcome: ${payout>0n ? "WIN" : "LOSE"}`;
      return;
    } catch (_) {}

    elOut.textContent = "Unrecognized data. Paste a LottoVIN tx hash/link, or event data.";
  } catch (e) {
    console.error(e);
    $("#decode-output").textContent = e?.message || "Failed to decode.";
  }
}

/* ===== Wire up ===== */
function wireEvents(){
  $("#connect-btn")?.addEventListener("click", connectWallet);
  $("#place-bet-btn")?.addEventListener("click", placeBet);
  $("#lucky-generate")?.addEventListener("click", luckyGenerate);
  $("#repeat-bet-btn")?.addEventListener("click", applyRepeat);
  $("#double-bet-btn")?.addEventListener("click", applyDouble);
  $("#halve-bet-btn")?.addEventListener("click", applyHalf);
  $("#decode-btn")?.addEventListener("click", decodeEventData);
  $("#decode-input")?.addEventListener("input", (e)=>autoResizeTextarea(e.target));
  initRows();
}

document.addEventListener("DOMContentLoaded", ()=> {
  wireEvents();
});
