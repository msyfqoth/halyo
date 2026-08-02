import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Area, AreaChart,
} from "recharts";

// ─────────────────────────────────────────────────────────────
// Halyo — the app. Three surfaces:
//   • Tutorial (first-run overlay, skippable, re-openable via Guide)
//   • Learn   (structured lessons)
//   • Trade   (matched strategy + backtested indicators, live data)
// Honest framing: education & analysis, never advice or promises.
// ─────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0e14", panel: "#111721", panel2: "#0d131c", line: "#1e2836",
  text: "#c8d3e0", dim: "#5c6a7e", accent: "#4ade80", accentDim: "#22c55e",
  warn: "#f59e0b", danger: "#ef4444", blue: "#38bdf8", violet: "#a78bfa",
  mono: "'JetBrains Mono','SF Mono',Menlo,monospace", sans: "'Inter',system-ui,sans-serif",
};

const COINS = {
  "BTC/USD": { id: "bitcoin", binance: "BTCUSDT", dp: 0 },
  "ETH/USD": { id: "ethereum", binance: "ETHUSDT", dp: 0 },
  "SOL/USD": { id: "solana", binance: "SOLUSDT", dp: 2 },
  "BNB/USD": { id: "binancecoin", binance: "BNBUSDT", dp: 2 },
};

// ── synthetic fallback ──
function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
function genSeries(seed,n,startPrice,drift,vol){const rand=mulberry32(seed);const out=[];let price=startPrice;const start=Date.now()-n*86400000;for(let i=0;i<n;i++){const shock=(rand()+rand()+rand()-1.5)*vol;price=Math.max(0.01,price*(1+drift+shock));out.push({i,t:start+i*86400000,close:price});}return out;}
const FALLBACK={"BTC/USD":{seed:7,start:62000,drift:0.0012,vol:0.028},"ETH/USD":{seed:21,start:2400,drift:0.001,vol:0.033},"SOL/USD":{seed:33,start:140,drift:0.0015,vol:0.045},"BNB/USD":{seed:51,start:560,drift:0.0008,vol:0.03}};

// ── indicators ──
function sma(data,period){const out=new Array(data.length).fill(null);let sum=0;for(let i=0;i<data.length;i++){sum+=data[i].close;if(i>=period)sum-=data[i-period].close;if(i>=period-1)out[i]=sum/period;}return out;}
function rsi(data,period=14){const out=new Array(data.length).fill(null);let gain=0,loss=0;for(let i=1;i<data.length;i++){const ch=data[i].close-data[i-1].close;const g=Math.max(0,ch),l=Math.max(0,-ch);if(i<=period){gain+=g;loss+=l;if(i===period){gain/=period;loss/=period;out[i]=100-100/(1+gain/(loss||1e-9));}}else{gain=(gain*(period-1)+g)/period;loss=(loss*(period-1)+l)/period;out[i]=100-100/(1+gain/(loss||1e-9));}}return out;}

function runBacktest(data,cfg){
  const{fast,slow,rsiFloor,rsiCeil,costBps,slipBps,useRsi,trendFilter}=cfg;
  const fastMA=sma(data,fast),slowMA=sma(data,slow),rsiArr=rsi(data,14);
  const trendMA=trendFilter?sma(data,100):null;
  const perSideCost=(costBps+slipBps)/10000;
  let inPos=false,entryPrice=0,equity=1,entryIdx=0;
  const equitySeries=[],trades=[];
  // Execution price for acting on a signal seen at bar i: use bar i+1's OPEN
  // if available (honest — you can only act after the signal bar closes),
  // otherwise fall back to bar i+1's close. Never the signal bar itself.
  const execPrice=(i)=>{ const nb=data[i+1]; if(!nb) return null; return (nb.open!=null?nb.open:nb.close); };
  for(let i=0;i<data.length;i++){
    const f=fastMA[i],s=slowMA[i],r=rsiArr[i],pf=fastMA[i-1],ps=slowMA[i-1];
    if(f!=null&&s!=null&&pf!=null&&ps!=null){
      const cu=pf<=ps&&f>s,cd=pf>=ps&&f<s,rok=!useRsi||(r!=null&&r>rsiFloor&&r<rsiCeil);
      const trendOk=!trendFilter||(trendMA[i]!=null&&data[i].close>trendMA[i]);
      if(!inPos&&cu&&rok&&trendOk){
        const px=execPrice(i); // enter next bar
        if(px!=null){inPos=true;entryPrice=px*(1+perSideCost);entryIdx=i+1;}
      }
      else if(inPos&&cd){
        const px=execPrice(i); // exit next bar
        if(px!=null){const ex=px*(1-perSideCost);const ret=ex/entryPrice-1;equity*=1+ret;trades.push({entryT:data[entryIdx].t,exitT:data[i+1].t,entryPrice,exitPrice:ex,ret,bars:(i+1)-entryIdx});inPos=false;}
      }
    }
    let me=equity;if(inPos)me=equity*(1+(data[i].close/entryPrice-1));
    equitySeries.push({t:data[i].t,equity:me});
  }
  const buyHold=data.length?data[data.length-1].close/data[0].close-1:0;
  const wins=trades.filter(t=>t.ret>0),losses=trades.filter(t=>t.ret<=0);
  const grossWin=wins.reduce((a,t)=>a+t.ret,0),grossLoss=Math.abs(losses.reduce((a,t)=>a+t.ret,0));
  let peak=-Infinity,maxDD=0;const rets=[];
  for(let i=0;i<equitySeries.length;i++){const e=equitySeries[i].equity;peak=Math.max(peak,e);maxDD=Math.min(maxDD,e/peak-1);if(i>0)rets.push(equitySeries[i].equity/equitySeries[i-1].equity-1);}
  const mean=rets.reduce((a,b)=>a+b,0)/(rets.length||1);
  const sd=Math.sqrt(rets.reduce((a,b)=>a+(b-mean)**2,0)/(rets.length||1));
  return{equitySeries,trades,fastMA,slowMA,rsiArr,metrics:{totalReturn:equity-1,buyHold,winRate:trades.length?wins.length/trades.length:0,expectancy:trades.length?trades.reduce((a,t)=>a+t.ret,0)/trades.length:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?Infinity:0),avgWin:wins.length?grossWin/wins.length:0,avgLoss:losses.length?-grossLoss/losses.length:0,maxDD,sharpe:sd?(mean/sd)*Math.sqrt(365):0,nTrades:trades.length}};
}

const fmtPct=(x)=>(x==null||!isFinite(x)?"—":`${(x*100).toFixed(1)}%`);
const fmtNum=(x)=>(x==null||!isFinite(x)?"—":x.toFixed(2));
const fmtDate=(t)=>new Date(t).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"2-digit"});

// ── multi-period test (segmented consistency check) ──
// NOTE: this is NOT true walk-forward optimisation (which re-fits parameters
// on each in-sample window and tests on the next out-of-sample window). It
// splits the series into N sequential segments and backtests each with the
// SAME fixed parameters, to show whether results are consistent across time
// or came from one lucky stretch. Labelled "multi-period test" in the UI to
// avoid overclaiming. True walk-forward is a roadmap item.
function walkForward(data,cfg,folds=5){
  if(data.length<folds*30)folds=Math.max(2,Math.floor(data.length/40));
  const foldSize=Math.floor(data.length/folds);
  const windows=[];
  let allTrades=[];
  for(let k=0;k<folds;k++){
    const start=k*foldSize;
    const end=k===folds-1?data.length:(k+1)*foldSize;
    const slice=data.slice(start,end);
    if(slice.length<25)continue;
    const bt=runBacktest(slice,cfg);
    const wins=bt.trades.filter(t=>t.ret>0).length;
    windows.push({
      idx:k+1,
      from:slice[0].t,
      to:slice[slice.length-1].t,
      winRate:bt.trades.length?wins/bt.trades.length:null,
      nTrades:bt.trades.length,
      ret:bt.metrics.totalReturn,
      maxDD:bt.metrics.maxDD,
    });
    allTrades=allTrades.concat(bt.trades);
  }
  // aggregate across every out-of-sample trade
  const wins=allTrades.filter(t=>t.ret>0),losses=allTrades.filter(t=>t.ret<=0);
  const grossWin=wins.reduce((a,t)=>a+t.ret,0),grossLoss=Math.abs(losses.reduce((a,t)=>a+t.ret,0));
  let compound=1;allTrades.forEach(t=>{compound*=1+t.ret;});
  const profitableWindows=windows.filter(w=>w.ret>0).length;
  return{
    windows,
    agg:{
      winRate:allTrades.length?wins.length/allTrades.length:0,
      nTrades:allTrades.length,
      expectancy:allTrades.length?allTrades.reduce((a,t)=>a+t.ret,0)/allTrades.length:0,
      profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?Infinity:0),
      totalReturn:compound-1,
      profitableWindows,
      totalWindows:windows.length,
      consistency:windows.length?profitableWindows/windows.length:0,
    },
  };
}

// ── strategy presets by risk profile ──
const STRATS={
  Conservative:{fast:20,slow:50,useRsi:true,defaultAsset:"BTC/USD",note:"Slow crossovers, fewer trades, longer trends."},
  Balanced:{fast:10,slow:30,useRsi:true,defaultAsset:"ETH/USD",note:"Balanced signals with RSI confirmation."},
  Aggressive:{fast:5,slow:20,useRsi:false,defaultAsset:"SOL/USD",note:"Fast crossovers, more trades, more noise."},
};

// ── lessons ──
const LESSONS=[
  {t:"What a moving-average crossover is",m:"3 min",body:"A moving average smooths price into a line. A 'fast' one (few days) reacts quickly; a 'slow' one (many days) reacts slowly. When the fast line crosses above the slow line, it's often read as a shift toward an uptrend; crossing below, a downtrend. The strategy buys the up-cross and exits on the down-cross. It's a trend-following idea — it does well in trends and poorly in choppy, sideways markets. No indicator predicts the future; this just reacts to what price has already done."},
  {t:"Why win rate alone lies to you",m:"4 min",body:"A 60% win rate sounds great, but it's meaningless without knowing the size of wins vs losses. If your average loss is bigger than your average win, you can win 60% of trades and still lose money. The metric that actually matters is expectancy: average profit per trade after costs. Always read win rate next to average win, average loss, and profit factor — never on its own."},
  {t:"Costs are where edges die",m:"3 min",body:"Every trade pays a spread, a fee, and slippage (the gap between the price you saw and the price you got). On paper a strategy might look profitable; after realistic costs, many aren't. Halyo bakes costs into every number by default. If a strategy only works with costs set to zero, it doesn't work."},
  {t:"Overfitting: fooling yourself with the past",m:"5 min",body:"If you tune a strategy until its historical results look amazing, you've often just memorized the noise of that specific period — it won't repeat. The defense is out-of-sample testing: optimize on older data, then measure on newer data the strategy never saw. If the out-of-sample result collapses, the strategy was overfit. Trust the test window, never the training window."},
  {t:"Position sizing & risk per trade",m:"4 min",body:"Surviving is the whole game. A common rule: risk only a small, fixed fraction of your capital on any single trade, so no one loss can hurt you badly. Higher-volatility assets need smaller positions for the same risk. The app shows suggested sizing per setup, but the decision — and the money — are always yours."},
  {t:"Reading the app's honest signals",m:"3 min",body:"The 'current read' tells you which side of its moving averages price is on right now. That's descriptive, not predictive — it is not a 'buy now' button. Use it as one input among many, alongside the backtested stats and your own judgement. The app never tells you to trade; it shows you what a rule would have done."},
];

function TradeApp({ initialProfile = "Balanced" }){
  const [tab,setTab]=useState("trade"); // trade | lab | learn
  const [profile,setProfile]=useState(initialProfile);
  const [showTutorial,setShowTutorial]=useState(true); // first-run
  const [tutStep,setTutStep]=useState(0);
  const [openLesson,setOpenLesson]=useState(null);

  // ── Lab (strategy sandbox) state — independent of the Trade tab ──
  const [labAsset,setLabAsset]=useState("BTC/USD");
  const [labFast,setLabFast]=useState(10);
  const [labSlow,setLabSlow]=useState(30);
  const [labMode,setLabMode]=useState("simple");   // simple | medium | advanced
  const [labUseRsi,setLabUseRsi]=useState(false);   // medium+
  const [labRsiFloor,setLabRsiFloor]=useState(30);  // medium+
  const [labRsiCeil,setLabRsiCeil]=useState(70);    // medium+
  const [labCost,setLabCost]=useState(10);          // medium+ (bps)
  const [labSpan,setLabSpan]=useState(730);         // medium+ days of data used
  const [labSplitPct,setLabSplitPct]=useState(65);  // advanced (train %)
  const [labTrendFilter,setLabTrendFilter]=useState(false); // advanced: long-term trend filter

  // ── Candles tab state ──
  const [candleQ,setCandleQ]=useState(0);       // current quiz question index
  const [candleAns,setCandleAns]=useState(null); // selected answer for current q
  const [candleScore,setCandleScore]=useState(0);

  const preset=STRATS[profile]||STRATS["Balanced"];
  const [asset,setAsset]=useState(preset.defaultAsset);
  const [seriesCache,setSeriesCache]=useState({});
  const [status,setStatus]=useState("idle");

  // when profile changes, snap asset to its default
  useEffect(()=>{setAsset((STRATS[profile]||STRATS["Balanced"]).defaultAsset);},[profile]);

  const fetchData=useCallback(async(a)=>{
    setStatus("loading");
    const cfg=COINS[a];
    // 1) Binance klines — permissive CORS, generous limits, reliable from browser.
    //    Returns arrays: [openTime, open, high, low, close, volume, ...]. We use close (idx 4).
    try{
      const res=await fetch(`https://api.binance.com/api/v3/klines?symbol=${cfg.binance}&interval=1d&limit=730`);
      if(!res.ok)throw new Error("binance "+res.status);
      const rows=await res.json();
      if(!Array.isArray(rows)||rows.length<60)throw new Error("thin");
      const series=rows.map((r,i)=>({i,t:r[0],open:parseFloat(r[1]),close:parseFloat(r[4])}));
      setSeriesCache(c=>({...c,[a]:{data:series,live:true,src:"Binance"}}));
      setStatus("live");
      return;
    }catch(e){/* fall through */}
    // 2) CoinGecko fallback — different shape: { prices: [[ts, price], ...] }.
    try{
      const res=await fetch(`https://api.coingecko.com/api/v3/coins/${cfg.id}/market_chart?vs_currency=usd&days=730&interval=daily`);
      if(!res.ok)throw new Error("cg "+res.status);
      const json=await res.json();
      if(!json.prices||json.prices.length<60)throw new Error("thin");
      setSeriesCache(c=>({...c,[a]:{data:json.prices.map((p,i)=>({i,t:p[0],close:p[1]})),live:true,src:"CoinGecko"}}));
      setStatus("live");
      return;
    }catch(e){/* fall through */}
    // 3) Deterministic synthetic — only if both live sources fail.
    const fb=FALLBACK[a];
    setSeriesCache(c=>({...c,[a]:{data:genSeries(fb.seed,730,fb.start,fb.drift,fb.vol),live:false,src:"demo"}}));
    setStatus("fallback");
  },[]);

  useEffect(()=>{if(!seriesCache[asset])fetchData(asset);else setStatus(seriesCache[asset].live?"live":"fallback");},[asset,seriesCache,fetchData]);

  const entry=seriesCache[asset];
  const data=entry?.data||[];
  const isLive=entry?.live;
  const splitIdx=Math.floor(data.length*0.65);
  const cfg={fast:preset.fast,slow:preset.slow,rsiFloor:30,rsiCeil:70,costBps:10,slipBps:5,useRsi:preset.useRsi};
  const trainBT=useMemo(()=>data.length?runBacktest(data.slice(0,splitIdx),cfg):null,[data,splitIdx,profile]);
  const testBT=useMemo(()=>data.length?runBacktest(data.slice(splitIdx),cfg):null,[data,splitIdx,profile]);
  const wf=useMemo(()=>data.length?walkForward(data,cfg,5):null,[data,profile]);

  // ── Lab: fetch its asset's data and run an in-sample vs out-of-sample backtest ──
  useEffect(()=>{ if(tab==="lab" && !seriesCache[labAsset]) fetchData(labAsset); },[tab,labAsset,seriesCache,fetchData]);
  const labEntry=seriesCache[labAsset];
  const labDataAll=labEntry?.data||[];
  // medium+ can limit how much history is used (date-range style)
  const labData=(labMode!=="simple" && labDataAll.length>labSpan) ? labDataAll.slice(labDataAll.length-labSpan) : labDataAll;
  const labSplit=Math.floor(labData.length*((labMode==="advanced"?labSplitPct:65)/100));
  const labCfg={
    fast:labFast, slow:labSlow,
    rsiFloor:labRsiFloor, rsiCeil:labRsiCeil,
    costBps:(labMode==="simple"?10:labCost), slipBps:5,
    useRsi:(labMode==="simple"?false:labUseRsi),
    trendFilter:(labMode==="advanced"?labTrendFilter:false),
  };
  const labDeps=[labData,labSplit,labFast,labSlow,labMode,labUseRsi,labRsiFloor,labRsiCeil,labCost,labTrendFilter];
  const labTrain=useMemo(()=>labData.length?runBacktest(labData.slice(0,labSplit),labCfg):null,labDeps);
  const labTest=useMemo(()=>labData.length?runBacktest(labData.slice(labSplit),labCfg):null,labDeps);
  const labFull=useMemo(()=>labData.length?runBacktest(labData,labCfg):null,labDeps);
  const labEquity=useMemo(()=>(labTrain&&labTest)?[...labTrain.equitySeries,...labTest.equitySeries]:[],[labTrain,labTest]);

  // Plain-language interpretation of the lab result — teaches, doesn't advise.
  const labVerdict=useMemo(()=>{
    if(!labTrain||!labTest) return null;
    const tr=labTrain.metrics.totalReturn, te=labTest.metrics.totalReturn, bh=labFull?.metrics.buyHold??0;
    const fewTrades=(labTest.metrics.nTrades||0)<5;
    if(fewTrades) return {tone:C.dim, text:"Very few trades in the out-of-sample period — not enough to judge. Try a longer history or faster averages so there's more to learn from."};
    if(tr>0.15 && te<=0) return {tone:C.danger, text:"Classic overfitting: strong on data it trained on, but it lost on data it never saw. Looking good on the past doesn't mean it works going forward — this is the trap most 'winning' strategies fall into."};
    if(te>0 && te<bh) return {tone:C.warn, text:"It made money out-of-sample, but less than simply buying and holding would have — after all that effort, doing nothing beat it. Common, and worth sitting with."};
    if(te>0 && te>=bh) return {tone:C.accent, text:"It held up on unseen data and beat buy-and-hold here. Encouraging — but one window isn't proof. Change the asset or split and see if it survives. Robustness matters more than one good result."};
    return {tone:C.warn, text:"Modest or negative out-of-sample result. That's the honest norm — most simple strategies don't beat the market after costs. The point is learning to see that clearly."};
  },[labTrain,labTest,labFull]);

  const dp=COINS[asset].dp;
  let stance="NEUTRAL",curRsi=null,lastBar=null,cf=null,cs=null;
  if(testBT&&data.length){
    const td=data.slice(splitIdx);
    cf=testBT.fastMA[testBT.fastMA.length-1];cs=testBT.slowMA[testBT.slowMA.length-1];
    curRsi=testBT.rsiArr[testBT.rsiArr.length-1];lastBar=td[td.length-1];
    if(cf!=null&&cs!=null)stance=cf>cs?"BULLISH BIAS":"BEARISH BIAS";
  }

  // ── live signal: is the strategy's trend-rule ON or OFF right now, and for how long ──
  const liveSignal=useMemo(()=>{
    if(!data.length)return null;
    const fma=sma(data,preset.fast),sma2=sma(data,preset.slow);
    let on=false,flipIdx=0;
    for(let i=1;i<data.length;i++){
      const f=fma[i],s=sma2[i],pf=fma[i-1],ps=sma2[i-1];
      if(f==null||s==null||pf==null||ps==null)continue;
      if(!on&&pf<=ps&&f>s){on=true;flipIdx=i;}
      else if(on&&pf>=ps&&f<s){on=false;flipIdx=i;}
    }
    const daysIn=data.length-1-flipIdx;
    // was the flip on the most recent bar? then it's a fresh entry/exit
    const fresh=daysIn===0;
    return{on,daysIn,fresh};
  },[data,preset.fast,preset.slow]);
  const equityChart=useMemo(()=>(trainBT&&testBT)?[...trainBT.equitySeries,...testBT.equitySeries]:[],[trainBT,testBT]);

  // ── tutorial steps ──
  const TUT=[
    {title:"Welcome to Halyo",body:"This is an analysis and learning tool — not a trading bot and not financial advice. It shows you how strategies would have behaved on real data, honestly. Let's take 30 seconds to show you around. You can skip anytime and reopen this from the Guide button.",cta:"Show me around"},
    {title:"Your matched strategy",body:"Based on your risk profile, the app preloads a strategy style and asset. Conservative leans to slower signals on BTC; Aggressive to faster signals on higher-volatility coins. You can switch profiles and assets anytime up top.",cta:"Next"},
    {title:"The numbers are out-of-sample",body:"Win rate, expectancy, and drawdown are measured on a test window the strategy never trained on — after fees and slippage. That's the honest way to judge a strategy. A number here is history, never a promise.",cta:"Next"},
    {title:"The current read is descriptive",body:"The bullish/bearish read tells you which side of its moving averages price sits on right now. It is NOT a 'buy now' signal. Use it as one input, alongside the Learn lessons and your own judgement.",cta:"Next"},
    {title:"Start with the lessons",body:"If any term is unfamiliar, the Learn tab explains crossovers, why win rate alone misleads, overfitting, and position sizing — in plain language. You keep full control of every decision and every dollar.",cta:"Start using Halyo"},
  ];

  const Metric=({label,value,tone,sub})=>(
    <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,padding:"11px 13px"}}>
      <div style={{fontSize:10,letterSpacing:1.1,textTransform:"uppercase",color:C.dim}}>{label}</div>
      <div style={{fontSize:20,fontFamily:C.mono,fontWeight:600,color:tone||C.text,marginTop:3}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:C.dim,fontFamily:C.mono,marginTop:2}}>{sub}</div>}
    </div>
  );

  const LabStat=({label,value,tone})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"5px 0",borderBottom:`1px solid ${C.line}`}}>
      <span style={{fontSize:12,color:C.dim}}>{label}</span>
      <span style={{fontSize:16,fontFamily:C.mono,fontWeight:600,color:tone||C.text}}>{value}</span>
    </div>
  );

  // Tap/hover info tooltip — mobile-friendly (tap toggles it open)
  const InfoTip=({text})=>{
    const [open,setOpen]=useState(false);
    return (
      <span style={{position:"relative",display:"inline-block",marginLeft:5}}>
        <span
          onClick={(e)=>{e.stopPropagation();setOpen(o=>!o);}}
          onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}
          style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:15,height:15,borderRadius:"50%",
            border:`1px solid ${C.dim}`,color:C.dim,fontSize:10,fontStyle:"italic",cursor:"pointer",fontFamily:"Georgia,serif",userSelect:"none",lineHeight:1}}
        >i</span>
        {open && (
          <span style={{position:"absolute",bottom:"140%",left:"50%",transform:"translateX(-50%)",width:210,
            background:"#05080d",border:`1px solid ${C.line}`,borderRadius:8,padding:"9px 11px",fontSize:11.5,
            color:C.text,lineHeight:1.5,zIndex:20,boxShadow:"0 6px 20px rgba(0,0,0,0.5)",fontFamily:C.sans,fontWeight:400,textTransform:"none",letterSpacing:0}}>
            {text}
          </span>
        )}
      </span>
    );
  };

  // ── Candle: draws a single candlestick as SVG ──
  // props: o,h,l,c (open,high,low,close) on a 0–100 scale; w=width; label=show anatomy labels
  const Candle=({o,h,l,c,w=120,ht=240,label=false,showLabels=[]})=>{
    const pad=label?90:14;
    const hi=Math.max(o,h,l,c),lo=Math.min(o,h,l,c);
    const range=(hi-lo)||1;
    const y=(v)=>ht-14-((v-lo)/range)*(ht-28);
    const up=c>=o;
    const col=up?C.accent:C.danger;
    const cx=pad+ (w-pad)/2;
    const bw=Math.min(38,(w-pad)*0.55);
    const bodyTop=y(Math.max(o,c)), bodyBot=y(Math.min(o,c));
    return (
      <svg width={w} height={ht} style={{overflow:"visible"}}>
        {/* wick */}
        <line x1={cx} y1={y(h)} x2={cx} y2={y(l)} stroke={col} strokeWidth={2}/>
        {/* body */}
        <rect x={cx-bw/2} y={bodyTop} width={bw} height={Math.max(2,bodyBot-bodyTop)} fill={col} rx={2}/>
        {label && (
          <g fontFamily={C.mono} fontSize={10} fill={C.dim}>
            <line x1={cx+bw/2+6} y1={y(h)} x2={cx+bw/2+40} y2={y(h)} stroke={C.line}/>
            <text x={cx+bw/2+44} y={y(h)+3} fill={C.text}>High (wick top)</text>
            <line x1={cx+bw/2+6} y1={bodyTop} x2={cx+bw/2+40} y2={bodyTop} stroke={C.line}/>
            <text x={cx+bw/2+44} y={bodyTop+3}>{up?"Close":"Open"} (body top)</text>
            <line x1={cx+bw/2+6} y1={bodyBot} x2={cx+bw/2+40} y2={bodyBot} stroke={C.line}/>
            <text x={cx+bw/2+44} y={bodyBot+3}>{up?"Open":"Close"} (body bottom)</text>
            <line x1={cx+bw/2+6} y1={y(l)} x2={cx+bw/2+40} y2={y(l)} stroke={C.line}/>
            <text x={cx+bw/2+44} y={y(l)+3} fill={C.text}>Low (wick bottom)</text>
            <text x={pad-8} y={(bodyTop+bodyBot)/2+3} textAnchor="end" fill={col} fontWeight="700">{up?"UP":"DOWN"}</text>
          </g>
        )}
      </svg>
    );
  };

  return(
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:C.sans}}>
      {/* top bar */}
      <div style={{borderBottom:`1px solid ${C.line}`,position:"sticky",top:0,background:C.bg,zIndex:10}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:18}}>
            <span style={{fontSize:18,fontWeight:700,letterSpacing:-0.5}}>Hal<span style={{color:C.accent}}>yo</span></span>
            <div style={{display:"flex",gap:4}}>
              {["trade","lab","candles","learn"].map(t=>(
                <button key={t} onClick={()=>setTab(t)} style={{
                  background:tab===t?C.panel:"transparent",color:tab===t?C.text:C.dim,
                  border:`1px solid ${tab===t?C.line:"transparent"}`,borderRadius:6,
                  padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer",textTransform:"capitalize",
                }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <select value={profile} onChange={e=>setProfile(e.target.value)} style={{
              background:C.panel2,color:C.text,border:`1px solid ${C.line}`,borderRadius:6,
              padding:"6px 10px",fontSize:12,fontFamily:C.mono,cursor:"pointer",
            }}>
              {Object.keys(STRATS).map(p=><option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={()=>{setTutStep(0);setShowTutorial(true);}} style={{
              background:"transparent",border:`1px solid ${C.line}`,color:C.dim,borderRadius:6,
              padding:"6px 12px",fontSize:12,cursor:"pointer",fontFamily:C.mono,
            }}>? Guide</button>
          </div>
        </div>
      </div>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"16px 14px"}}>
        {/* honesty strip */}
        <div style={{background:"rgba(245,158,11,0.06)",border:`1px solid rgba(245,158,11,0.22)`,borderRadius:8,padding:"8px 14px",marginBottom:18,fontSize:11.5,color:"#e8c67a",lineHeight:1.5}}>
          <strong style={{color:C.warn}}>Live signals & education — not advice or prediction.</strong> Signals come from strategy rules on live data and can be wrong. Win rates are historical, after costs. Crypto is volatile; you can lose money. Every decision is yours.
        </div>

        {tab==="trade"?(
          <>
            {/* controls row */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:16}}>
              <div style={{display:"flex",gap:6}}>
                {Object.keys(COINS).map(a=>(
                  <button key={a} onClick={()=>setAsset(a)} style={{
                    background:asset===a?C.accent:C.panel2,color:asset===a?"#08120a":C.text,
                    border:`1px solid ${asset===a?C.accent:C.line}`,borderRadius:6,
                    padding:"7px 12px",fontSize:12,fontFamily:C.mono,fontWeight:600,cursor:"pointer",
                  }}>{a}</button>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:status==="live"?C.accent:status==="loading"?C.warn:C.danger,boxShadow:status==="live"?`0 0 8px ${C.accent}`:"none"}}/>
                <span style={{fontSize:10,color:C.dim,fontFamily:C.mono}}>
                  {status==="live"?`LIVE · ${entry?.src||"market"}`:status==="loading"?"loading…":"DEMO fallback"}
                </span>
                <button
                  onClick={()=>{setSeriesCache(c=>{const n={...c};delete n[asset];return n;});fetchData(asset);}}
                  disabled={status==="loading"}
                  title="Re-fetch the latest live prices"
                  style={{
                    background:"transparent",border:`1px solid ${C.line}`,color:C.dim,
                    borderRadius:6,padding:"4px 9px",fontSize:11,fontFamily:C.mono,
                    cursor:status==="loading"?"default":"pointer",opacity:status==="loading"?0.5:1,
                  }}>↻ Refresh</button>
              </div>
            </div>

            {data.length===0?(
              <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:40,textAlign:"center",color:C.dim,fontFamily:C.mono}}>Loading {asset}…</div>
            ):(
              <>
                {/* ── STRATEGY STATE panel: descriptive, educational — not a trade instruction ── */}
                {(()=>{
                  const on=liveSignal?.on;
                  const fresh=liveSignal?.fresh;
                  // Map strategy state → a NEUTRAL, descriptive label (learning lens, not a call to act)
                  let state,sColor,sSub;
                  if(on&&fresh){
                    state="TREND STARTED"; sColor=C.accent;
                    sSub="This strategy's rules just flipped to \"in trend\" today. Studying what happens next — and how often these turn into real moves vs. false starts — is the whole point.";
                  }else if(!on&&fresh){
                    state="TREND ENDED"; sColor=C.warn;
                    sSub="The rules just flipped to \"out of trend\" today. Notice how the strategy would have stepped aside here — exiting is as important to study as entering.";
                  }else if(on){
                    state="IN A TREND"; sColor=C.blue;
                    sSub=`By this strategy's rules, the market has been trending for ${liveSignal.daysIn} days. Watch how long trends persist — and how often they reverse right after you'd expect them to continue.`;
                  }else{
                    state="NO CLEAR TREND"; sColor=C.dim;
                    sSub="The rules show no trend right now — the strategy would be sitting in cash. Most of the time looks like this. Learning to do nothing is a real skill.";
                  }
                  const wr=testBT.metrics.winRate;
                  return(
                    <div style={{background:C.panel,border:`1.5px solid ${sColor}`,borderRadius:14,padding:"22px 22px",marginBottom:16}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:18}}>
                        {/* left: the descriptive state */}
                        <div style={{flex:"1 1 260px"}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                            <span style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:C.dim}}>{asset} · {profile} strategy</span>
                            <span style={{width:6,height:6,borderRadius:"50%",background:status==="live"?C.accent:C.danger}}/>
                            <span style={{fontSize:9,fontFamily:C.mono,color:C.dim}}>{status==="live"?"live":"demo"}</span>
                          </div>
                          <div style={{fontSize:9.5,letterSpacing:1.5,textTransform:"uppercase",color:C.dim,marginBottom:4}}>What this strategy's rules currently show</div>
                          <div style={{fontSize:42,fontWeight:800,fontFamily:C.mono,color:sColor,lineHeight:1.05,letterSpacing:-1}}>
                            {state}
                          </div>
                          <div style={{fontSize:14,color:C.text,lineHeight:1.5,marginTop:10,maxWidth:440}}>{sSub}</div>
                          <div style={{fontSize:11,color:C.warn,marginTop:8,fontStyle:"italic"}}>
                            A description of a rule's state for learning — not a recommendation to buy or sell anything. Halyo does not tell you what to trade.
                          </div>
                        </div>
                        {/* right: track record + price — framed as "what studying this teaches" */}
                        <div style={{display:"flex",gap:20,flexWrap:"wrap",flex:"1 1 240px"}}>
                          <div>
                            <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>Hit rate</div>
                            <div style={{fontSize:28,fontFamily:C.mono,fontWeight:700,color:wr>=0.5?C.accent:C.warn,lineHeight:1.1}}>{fmtPct(wr)}</div>
                            <div style={{fontSize:9,fontFamily:C.mono,color:C.dim}}>{testBT.metrics.nTrades} signals · after costs</div>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>Worst dip</div>
                            <div style={{fontSize:28,fontFamily:C.mono,fontWeight:600,color:C.danger,lineHeight:1.1}}>{fmtPct(testBT.metrics.maxDD)}</div>
                            <div style={{fontSize:9,fontFamily:C.mono,color:C.dim}}>historical drawdown</div>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:1}}>Price</div>
                            <div style={{fontSize:28,fontFamily:C.mono,fontWeight:600,lineHeight:1.1}}>${lastBar?lastBar.close.toLocaleString(undefined,{maximumFractionDigits:dp,minimumFractionDigits:dp}):"—"}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* metrics */}
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                  <span style={{fontSize:11,letterSpacing:1,textTransform:"uppercase",color:C.blue,fontWeight:600}}>Backtested performance</span>
                  <span style={{fontSize:10,color:C.dim,fontFamily:C.mono}}>(out-of-sample · after costs)</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:10}}>
                  <Metric label="Win rate" value={fmtPct(testBT.metrics.winRate)} sub={`${testBT.metrics.nTrades} trades`} tone={testBT.metrics.winRate>=0.5?C.accent:C.warn}/>
                  <Metric label="Expectancy" value={fmtPct(testBT.metrics.expectancy)} sub="per trade" tone={testBT.metrics.expectancy>0?C.accent:C.danger}/>
                  <Metric label="Profit factor" value={fmtNum(testBT.metrics.profitFactor)} tone={testBT.metrics.profitFactor>=1?C.accent:C.danger}/>
                  <Metric label="Max drawdown" value={fmtPct(testBT.metrics.maxDD)} sub="worst dip" tone={C.danger}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:16}}>
                  <Metric label="Strategy return" value={fmtPct(testBT.metrics.totalReturn)} tone={testBT.metrics.totalReturn>0?C.accent:C.danger}/>
                  <Metric label="Buy & hold" value={fmtPct(testBT.metrics.buyHold)} sub="benchmark"/>
                  <Metric label="Sharpe" value={fmtNum(testBT.metrics.sharpe)} tone={testBT.metrics.sharpe>1?C.accent:C.text}/>
                  <Metric label="Avg win/loss" value={`${fmtPct(testBT.metrics.avgWin)} / ${fmtPct(testBT.metrics.avgLoss)}`}/>
                </div>

                {/* ── MULTI-PERIOD TEST ── */}
                {wf&&wf.windows.length>0&&(()=>{
                  const a=wf.agg;
                  const consistent=a.consistency>=0.6;
                  return(
                    <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:16,marginBottom:16}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                        <span style={{fontSize:11,letterSpacing:1,textTransform:"uppercase",color:C.violet,fontWeight:600}}>Multi-period test</span>
                        <span style={{fontSize:10,color:C.dim,fontFamily:C.mono}}>(consistency check across time)</span>
                      </div>
                      <div style={{fontSize:12,color:C.dim,lineHeight:1.5,marginBottom:14,maxWidth:600}}>
                        The strategy is retested across {a.totalWindows} separate time windows.
                        This shows whether results held up <em>consistently</em> — or came from one lucky stretch.
                        <span style={{color:C.dim,fontStyle:"italic"}}> (Not the same as true walk-forward optimisation, which is on our roadmap.)</span>
                      </div>

                      {/* aggregate row */}
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}>
                        <Metric label="Win rate" value={fmtPct(a.winRate)} sub={`${a.nTrades} trades, all windows`} tone={a.winRate>=0.5?C.accent:C.warn}/>
                        <Metric label="Expectancy" value={fmtPct(a.expectancy)} sub="per trade, after cost" tone={a.expectancy>0?C.accent:C.danger}/>
                        <Metric label="Return" value={fmtPct(a.totalReturn)} sub="compounded" tone={a.totalReturn>0?C.accent:C.danger}/>
                        <Metric label="Consistency" value={`${a.profitableWindows}/${a.totalWindows}`} sub="profitable windows" tone={consistent?C.accent:C.warn}/>
                      </div>

                      {/* per-window bars */}
                      <div style={{fontSize:9.5,letterSpacing:1,textTransform:"uppercase",color:C.dim,marginBottom:8}}>Return by window (oldest → newest)</div>
                      <div style={{display:"flex",gap:6,alignItems:"flex-end",height:70,marginBottom:6}}>
                        {wf.windows.map(w=>{
                          const h=Math.min(60,Math.abs(w.ret)*180+6);
                          return(
                            <div key={w.idx} style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
                              <div style={{fontSize:9,fontFamily:C.mono,color:w.ret>=0?C.accent:C.danger,marginBottom:2}}>{w.ret>=0?"+":""}{(w.ret*100).toFixed(0)}%</div>
                              <div style={{width:"70%",height:h,background:w.ret>=0?C.accentDim:C.danger,borderRadius:3,opacity:0.85}}/>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {wf.windows.map(w=>(
                          <div key={w.idx} style={{flex:1,minWidth:0,textAlign:"center",fontSize:8.5,fontFamily:C.mono,color:C.dim,overflow:"hidden"}}>{new Date(w.from).toLocaleDateString("en-GB",{month:"short",year:"2-digit"})}</div>
                        ))}
                      </div>

                      <div style={{marginTop:14,padding:"10px 13px",borderRadius:8,fontSize:12,lineHeight:1.5,
                        background:consistent?"rgba(74,222,128,0.06)":"rgba(245,158,11,0.06)",
                        border:`1px solid ${consistent?"rgba(74,222,128,0.25)":"rgba(245,158,11,0.25)"}`,color:consistent?C.accentDim:"#e8c67a"}}>
                        {consistent
                          ?`Held up in ${a.profitableWindows} of ${a.totalWindows} windows — the edge looks reasonably consistent, not a fluke of one period. Still no guarantee of the future.`
                          :`Only ${a.profitableWindows} of ${a.totalWindows} windows were profitable — the edge is inconsistent and may have come from one lucky stretch. Treat this strategy with caution.`}
                      </div>
                    </div>
                  );
                })()}

                {/* risk callout */}
                <div style={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,padding:"11px 14px",marginBottom:16,fontSize:12,lineHeight:1.55,color:C.text}}>
                  <span style={{color:C.warn,fontWeight:600}}>Risk on this strategy: </span>
                  worst historical drawdown was {fmtPct(testBT.metrics.maxDD)}. Size positions so a drawdown like that wouldn't force you out. Higher-volatility assets ({asset}) warrant smaller positions.
                </div>

                {/* equity */}
                <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:"14px 12px 6px",marginBottom:16}}>
                  <div style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:C.dim,marginBottom:8,paddingLeft:6}}>Equity curve · train → test</div>
                  <ResponsiveContainer width="100%" height={210}>
                    <AreaChart data={equityChart} margin={{top:4,right:8,left:-18,bottom:0}}>
                      <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.25}/><stop offset="100%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
                      <XAxis dataKey="t" tickFormatter={fmtDate} tick={{fill:C.dim,fontSize:10}} stroke={C.line} minTickGap={60}/>
                      <YAxis tickFormatter={v=>`${(v*100).toFixed(0)}`} tick={{fill:C.dim,fontSize:10}} stroke={C.line} domain={["auto","auto"]}/>
                      <Tooltip contentStyle={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,fontSize:11,fontFamily:C.mono}} labelFormatter={fmtDate} formatter={v=>[`${(v*100).toFixed(1)}%`,"equity"]}/>
                      <ReferenceLine x={data[splitIdx]?.t} stroke={C.blue} strokeDasharray="4 4" label={{value:"test →",fill:C.blue,fontSize:10,position:"insideTopRight"}}/>
                      <ReferenceLine y={1} stroke={C.line}/>
                      <Area type="monotone" dataKey="equity" stroke={C.accent} strokeWidth={1.6} fill="url(#eq)" dot={false} isAnimationActive={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* price + MAs */}
                <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:"14px 12px 6px"}}>
                  <div style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:C.dim,marginBottom:8,paddingLeft:6}}>Price & moving averages</div>
                  <ResponsiveContainer width="100%" height={190}>
                    <LineChart data={data.map((d,idx)=>({...d,fast:idx<splitIdx?trainBT.fastMA[idx]:testBT.fastMA[idx-splitIdx],slow:idx<splitIdx?trainBT.slowMA[idx]:testBT.slowMA[idx-splitIdx]}))} margin={{top:4,right:8,left:-18,bottom:0}}>
                      <XAxis dataKey="t" tickFormatter={fmtDate} tick={{fill:C.dim,fontSize:10}} stroke={C.line} minTickGap={60}/>
                      <YAxis tick={{fill:C.dim,fontSize:10}} stroke={C.line} domain={["auto","auto"]} tickFormatter={v=>v>=1000?`${(v/1000).toFixed(0)}k`:v.toFixed(0)}/>
                      <Tooltip contentStyle={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,fontSize:11,fontFamily:C.mono}} labelFormatter={fmtDate} formatter={v=>v!=null?v.toFixed(2):"—"}/>
                      <ReferenceLine x={data[splitIdx]?.t} stroke={C.blue} strokeDasharray="4 4"/>
                      <Line type="monotone" dataKey="close" stroke={C.text} strokeWidth={1.2} dot={false} isAnimationActive={false} name="price"/>
                      <Line type="monotone" dataKey="fast" stroke={C.accent} strokeWidth={1} dot={false} isAnimationActive={false} name="fast MA"/>
                      <Line type="monotone" dataKey="slow" stroke={C.warn} strokeWidth={1} dot={false} isAnimationActive={false} name="slow MA"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{fontSize:10,color:C.dim,textAlign:"center",marginTop:16,fontFamily:C.mono,lineHeight:1.6}}>
                  {isLive?`Live daily closes from ${entry?.src||"exchange"} (1yr).`:"Both live sources busy — demo data shown."} Crypto only · no broker execution.
                  <div style={{marginTop:8}}>
                    <a href="/risk-disclaimer.html" target="_blank" rel="noopener" style={{color:C.dim,textDecoration:"underline"}}>Risk Disclaimer</a>
                    <span style={{margin:"0 6px"}}>·</span>
                    <a href="/terms.html" target="_blank" rel="noopener" style={{color:C.dim,textDecoration:"underline"}}>Terms</a>
                    <span style={{margin:"0 6px"}}>·</span>
                    <a href="/privacy.html" target="_blank" rel="noopener" style={{color:C.dim,textDecoration:"underline"}}>Privacy</a>
                    <span style={{margin:"0 6px"}}>·</span>
                    <a href="mailto:support@halyoapp.com" style={{color:C.dim,textDecoration:"underline"}}>Support</a>
                  </div>
                </div>
              </>
            )}
          </>
        ):tab==="lab"?(
          // ── LAB TAB — Simple mode strategy sandbox ──
          <div style={{maxWidth:820,margin:"0 auto"}}>
            <div style={{marginBottom:14}}>
              <h2 style={{fontSize:24,fontWeight:800,letterSpacing:-0.5,margin:"0 0 6px"}}>Strategy Lab</h2>
              <p style={{fontSize:14,color:C.dim,lineHeight:1.6,margin:0,maxWidth:640}}>
                Build a strategy and see honestly how it would have performed — after costs, split
                into what it "trained" on vs. data it never saw. Start Simple, then add complexity.
                This is for <strong style={{color:C.text}}>learning how strategies behave</strong>, not finding one to trade.
              </p>
            </div>

            {/* complexity selector */}
            <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
              {[["simple","Simple"],["medium","Medium"],["advanced","Advanced"]].map(([m,label])=>(
                <button key={m} onClick={()=>setLabMode(m)} style={{
                  background:labMode===m?C.accent:C.panel2, color:labMode===m?"#08120a":C.dim,
                  border:`1px solid ${labMode===m?C.accent:C.line}`, borderRadius:8, padding:"8px 18px",
                  fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:C.sans,
                }}>{label}</button>
              ))}
              <div style={{flex:1}}/>
            </div>
            <div style={{fontSize:11.5,color:C.dim,marginBottom:14,lineHeight:1.5}}>
              {labMode==="simple" && "Simple: just the two moving averages. The cleanest way to see a crossover strategy."}
              {labMode==="medium" && "Medium: add an RSI filter, adjust trading costs, and choose how much history to test on."}
              {labMode==="advanced" && "Advanced: add a long-term trend filter and change the train/test split. Watch how easy it is to 'tune' great in-sample numbers that fall apart out-of-sample — that's the overfitting trap."}
            </div>

            {/* controls */}
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:"18px 18px",marginBottom:16}}>
              <div style={{display:"flex",flexWrap:"wrap",gap:20,alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Asset</div>
                  <select value={labAsset} onChange={e=>setLabAsset(e.target.value)} style={{
                    background:C.panel2,color:C.text,border:`1px solid ${C.line}`,borderRadius:6,padding:"8px 12px",fontSize:13,fontFamily:C.mono,cursor:"pointer",
                  }}>
                    {Object.keys(COINS).map(a=><option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div style={{flex:"1 1 180px"}}>
                  <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>
                    Fast MA — <span style={{color:C.accent}}>{labFast} days</span>
                    <InfoTip text="The short-term average of price. It reacts quickly to recent moves. When it rises above the slow average, that's read as a possible uptrend starting."/>
                  </div>
                  <input type="range" min={2} max={50} value={labFast} onChange={e=>setLabFast(Math.min(+e.target.value,labSlow-1))} style={{width:"100%",accentColor:C.accent}}/>
                </div>
                <div style={{flex:"1 1 180px"}}>
                  <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>
                    Slow MA — <span style={{color:C.blue}}>{labSlow} days</span>
                    <InfoTip text="The long-term average of price. It moves slowly and smooths out noise. The strategy buys when the fast average crosses above this one, and sells when it crosses back below."/>
                  </div>
                  <input type="range" min={5} max={120} value={labSlow} onChange={e=>setLabSlow(Math.max(+e.target.value,labFast+1))} style={{width:"100%",accentColor:C.blue}}/>
                </div>
              </div>

              {/* MEDIUM controls */}
              {labMode!=="simple" && (
                <div style={{marginTop:18,paddingTop:16,borderTop:`1px solid ${C.line}`,display:"flex",flexWrap:"wrap",gap:20,alignItems:"flex-end"}}>
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:C.text}}>
                    <input type="checkbox" checked={labUseRsi} onChange={e=>setLabUseRsi(e.target.checked)} style={{accentColor:C.accent,width:16,height:16}}/>
                    RSI filter
                  </label>
                  <InfoTip text="RSI measures momentum from 0–100. This filter only lets the strategy buy when RSI is in a 'normal' range — the idea is to avoid buying when price is already overheated. Whether it actually helps is exactly what you're here to test."/>
                  {labUseRsi && (
                    <>
                      <div style={{flex:"1 1 150px"}}>
                        <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>RSI floor — <span style={{color:C.accent}}>{labRsiFloor}</span></div>
                        <input type="range" min={10} max={50} value={labRsiFloor} onChange={e=>setLabRsiFloor(Math.min(+e.target.value,labRsiCeil-5))} style={{width:"100%",accentColor:C.accent}}/>
                      </div>
                      <div style={{flex:"1 1 150px"}}>
                        <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>RSI ceiling — <span style={{color:C.blue}}>{labRsiCeil}</span></div>
                        <input type="range" min={50} max={90} value={labRsiCeil} onChange={e=>setLabRsiCeil(Math.max(+e.target.value,labRsiFloor+5))} style={{width:"100%",accentColor:C.blue}}/>
                      </div>
                    </>
                  )}
                  <div style={{flex:"1 1 150px"}}>
                    <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Cost — <span style={{color:C.warn}}>{(labCost/100).toFixed(2)}%</span> / trade<InfoTip text="What each trade costs you in fees and slippage. It sounds tiny, but a strategy that trades often can be quietly killed by costs. Slide it up and watch profitable strategies turn into losers — this is where most edges die."/></div>
                    <input type="range" min={0} max={50} value={labCost} onChange={e=>setLabCost(+e.target.value)} style={{width:"100%",accentColor:C.warn}}/>
                  </div>
                  <div style={{flex:"1 1 150px"}}>
                    <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>History — <span style={{color:C.text}}>{labSpan} days</span><InfoTip text="How much past data to test on. More history means more market conditions (bull, bear, sideways) — a strategy that only worked in one kind of market often falls apart across all of them."/></div>
                    <input type="range" min={180} max={730} step={30} value={labSpan} onChange={e=>setLabSpan(+e.target.value)} style={{width:"100%",accentColor:C.dim}}/>
                  </div>
                </div>
              )}

              {/* ADVANCED controls */}
              {labMode==="advanced" && (
                <div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.line}`,display:"flex",flexWrap:"wrap",gap:20,alignItems:"flex-end"}}>
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:C.text}}>
                    <input type="checkbox" checked={labTrendFilter} onChange={e=>setLabTrendFilter(e.target.checked)} style={{accentColor:C.accent,width:16,height:16}}/>
                    Long-term trend filter (only buy above 100-day average)
                  </label>
                  <InfoTip text="A common pro rule: only take buy signals when price is above its 100-day average, i.e. only trade 'with the tide.' It usually cuts the number of trades. Test whether it actually improves the out-of-sample result or just looks tidier."/>
                  <div style={{flex:"1 1 200px"}}>
                    <div style={{fontSize:11,color:C.dim,fontFamily:C.mono,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Train / test split — <span style={{color:C.blue}}>{labSplitPct}% / {100-labSplitPct}%</span><InfoTip text="How the data is divided: the strategy 'learns' on the first part, then is judged on the rest it never saw. Slide this around — if the result swings wildly depending on where you cut, that's a warning the strategy isn't robust."/></div>
                    <input type="range" min={40} max={80} step={5} value={labSplitPct} onChange={e=>setLabSplitPct(+e.target.value)} style={{width:"100%",accentColor:C.blue}}/>
                  </div>
                </div>
              )}
              <div style={{fontSize:11,color:C.dim,marginTop:12,lineHeight:1.5}}>
                When the {labFast}-day average crosses above the {labSlow}-day, the strategy buys; when it crosses below, it sells. Drag the sliders and watch the results change.
              </div>
            </div>

            {!labData.length?(
              <div style={{textAlign:"center",padding:40,color:C.dim,fontFamily:C.mono,fontSize:13}}>Loading {labAsset} data…</div>
            ):(
              <>
                {/* results: in-sample vs out-of-sample side by side */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12,marginBottom:16}}>
                  <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:18}}>
                    <div style={{fontSize:11,fontFamily:C.mono,color:C.dim,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>In-sample (trained on)<InfoTip text="Results on the older data the strategy was built around. Almost anything can look good here — you're seeing how it did on the very data used to pick the settings."/></div>
                    <LabStat label="Return" value={fmtPct(labTrain?.metrics.totalReturn)} tone={labTrain?.metrics.totalReturn>0?C.accent:C.danger}/>
                    <LabStat label="Win rate" value={fmtPct(labTrain?.metrics.winRate)}/>
                    <LabStat label="Worst dip" value={fmtPct(labTrain?.metrics.maxDD)} tone={C.danger}/>
                    <LabStat label="Trades" value={labTrain?.metrics.nTrades??"—"}/>
                  </div>
                  <div style={{background:C.panel,border:`1.5px solid ${C.accent}`,borderRadius:12,padding:18}}>
                    <div style={{fontSize:11,fontFamily:C.mono,color:C.accent,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Out-of-sample (never seen) ★<InfoTip text="Results on newer data the strategy never saw while being built. THIS is the honest test — it's the closest thing to 'how would it have done on the future.' Trust this column far more than the other one."/></div>
                    <LabStat label="Return" value={fmtPct(labTest?.metrics.totalReturn)} tone={labTest?.metrics.totalReturn>0?C.accent:C.danger}/>
                    <LabStat label="Win rate" value={fmtPct(labTest?.metrics.winRate)}/>
                    <LabStat label="Worst dip" value={fmtPct(labTest?.metrics.maxDD)} tone={C.danger}/>
                    <LabStat label="Trades" value={labTest?.metrics.nTrades??"—"}/>
                  </div>
                </div>

                {/* self-explaining verdict — interprets the result in plain language */}
                {labVerdict && (
                  <div style={{background:C.panel,border:`1px solid ${labVerdict.tone}`,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
                    <div style={{fontSize:10,fontFamily:C.mono,letterSpacing:1.5,textTransform:"uppercase",color:labVerdict.tone,marginBottom:6}}>What this result is telling you</div>
                    <div style={{fontSize:13.5,color:C.text,lineHeight:1.6}}>{labVerdict.text}</div>
                    <div style={{fontSize:11.5,color:C.dim,marginTop:8}}>For reference, simply buying and holding {labAsset} over this period returned {fmtPct(labFull?.metrics.buyHold)}.</div>
                  </div>
                )}

                {/* equity curve */}
                <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:"16px 12px 8px"}}>
                  <div style={{fontSize:11,fontFamily:C.mono,color:C.dim,letterSpacing:1,textTransform:"uppercase",marginBottom:8,paddingLeft:8}}>Equity curve · train → test</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={labEquity}>
                      <defs><linearGradient id="labEq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.4}/><stop offset="100%" stopColor={C.accent} stopOpacity={0}/></linearGradient></defs>
                      <XAxis dataKey="t" tickFormatter={fmtDate} tick={{fontSize:10,fill:C.dim}} minTickGap={40}/>
                      <YAxis tick={{fontSize:10,fill:C.dim}} width={40} domain={["auto","auto"]}/>
                      <Tooltip contentStyle={{background:C.panel2,border:`1px solid ${C.line}`,borderRadius:8,fontSize:12}} labelFormatter={fmtDate} formatter={(v)=>[fmtNum(v),"equity"]}/>
                      {labData[labSplit]&&<ReferenceLine x={labData[labSplit].t} stroke={C.blue} strokeDasharray="4 4" label={{value:"test →",fill:C.blue,fontSize:10}}/>}
                      <Area type="monotone" dataKey="equity" stroke={C.accent} strokeWidth={2} fill="url(#labEq)"/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div style={{fontSize:11,color:C.dim,textAlign:"center",marginTop:14,fontFamily:C.mono,lineHeight:1.6}}>
                  Educational sandbox · results are historical, after costs · a good backtest never guarantees future results.
                  <div style={{marginTop:8}}>
                    <a href="/risk-disclaimer.html" target="_blank" rel="noopener" style={{color:C.dim,textDecoration:"underline"}}>Risk Disclaimer</a>
                    <span style={{margin:"0 6px"}}>·</span>
                    <a href="mailto:support@halyoapp.com" style={{color:C.dim,textDecoration:"underline"}}>Support</a>
                  </div>
                </div>
              </>
            )}
          </div>
        ):tab==="candles"?(
          // ── CANDLES TAB — anatomy + patterns + quiz ──
          <div style={{maxWidth:820,margin:"0 auto"}}>
            <div style={{marginBottom:20}}>
              <h2 style={{fontSize:24,fontWeight:800,letterSpacing:-0.5,margin:"0 0 6px"}}>Reading candles</h2>
              <p style={{fontSize:14,color:C.dim,lineHeight:1.6,margin:0,maxWidth:640}}>
                Every candle tells you four numbers and one short story. Learn to read them here —
                honestly, including what they <strong style={{color:C.text}}>can't</strong> tell you.
              </p>
            </div>

            {/* SECTION 1 — anatomy */}
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:"20px 20px",marginBottom:20}}>
              <div style={{fontSize:11,fontFamily:C.mono,color:C.accent,letterSpacing:1.5,textTransform:"uppercase",marginBottom:14}}>1 · Anatomy of a candle</div>
              <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{minWidth:280}}>
                  <Candle o={38} h={80} l={20} c={70} w={280} ht={240} label/>
                </div>
                <div style={{flex:"1 1 240px",fontSize:13.5,color:C.text,lineHeight:1.7}}>
                  <p style={{margin:"0 0 10px"}}>Each candle covers one time period (here, one day). It shows four prices:</p>
                  <p style={{margin:"0 0 6px"}}><strong style={{color:C.accent}}>Open</strong> — price at the start · <strong style={{color:C.accent}}>Close</strong> — price at the end.</p>
                  <p style={{margin:"0 0 6px"}}>The thick <strong>body</strong> spans open→close. The thin <strong>wicks</strong> reach the <strong>High</strong> and <strong>Low</strong> touched during the period.</p>
                  <p style={{margin:"0 0 6px"}}><span style={{color:C.accent,fontWeight:700}}>Green</span> = closed higher than it opened (buyers won). <span style={{color:C.danger,fontWeight:700}}>Red</span> = closed lower (sellers won).</p>
                  <p style={{margin:"10px 0 0",fontSize:12,color:C.dim,fontStyle:"italic"}}>That's it. A candle is a record of what already happened — not a prediction.</p>
                </div>
              </div>
            </div>

            {/* SECTION 2 — patterns */}
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,fontFamily:C.mono,color:C.accent,letterSpacing:1.5,textTransform:"uppercase",marginBottom:14,paddingLeft:2}}>2 · Common patterns (and the honest truth)</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:12}}>
                {CANDLE_PATTERNS.map((p,i)=>(
                  <div key={i} style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:16,display:"flex",gap:14}}>
                    <div style={{flexShrink:0}}><Candle {...p.ohlc} w={64} ht={120}/></div>
                    <div style={{fontSize:12.5,lineHeight:1.55}}>
                      <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:4}}>{p.name}</div>
                      <div style={{color:C.dim,marginBottom:6}}>{p.what}</div>
                      <div style={{color:C.text,marginBottom:6}}><strong style={{color:C.blue}}>Shows:</strong> {p.means}</div>
                      <div style={{color:C.warn,fontSize:11.5,fontStyle:"italic"}}>{p.honest}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* SECTION 3 — quiz */}
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:12,padding:"20px 20px",marginBottom:20}}>
              <div style={{fontSize:11,fontFamily:C.mono,color:C.accent,letterSpacing:1.5,textTransform:"uppercase",marginBottom:14}}>3 · Test yourself</div>
              {candleQ>=CANDLE_QUIZ.length ? (
                <div style={{textAlign:"center",padding:"20px 0"}}>
                  <div style={{fontSize:34,fontWeight:800,color:C.accent,fontFamily:C.mono}}>{candleScore}/{CANDLE_QUIZ.length}</div>
                  <div style={{fontSize:14,color:C.text,margin:"8px 0 4px"}}>Nice work. You can read the basic candles.</div>
                  <div style={{fontSize:12,color:C.dim,maxWidth:420,margin:"0 auto 16px",lineHeight:1.6}}>Remember the honest part: naming a candle is easy — but no candle reliably predicts the next one. Use the Lab to test whether any pattern-based idea actually holds up.</div>
                  <button onClick={()=>{setCandleQ(0);setCandleAns(null);setCandleScore(0);}} style={{background:C.panel2,color:C.text,border:`1px solid ${C.line}`,borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Try again</button>
                </div>
              ):(
                <>
                  <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
                    <div style={{flexShrink:0}}><Candle {...CANDLE_QUIZ[candleQ].ohlc} w={90} ht={180}/></div>
                    <div style={{flex:"1 1 260px"}}>
                      <div style={{fontSize:11,fontFamily:C.mono,color:C.dim,marginBottom:8}}>Question {candleQ+1} / {CANDLE_QUIZ.length}</div>
                      <div style={{fontSize:15,color:C.text,marginBottom:14,lineHeight:1.5}}>{CANDLE_QUIZ[candleQ].q}</div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {CANDLE_QUIZ[candleQ].options.map((opt,oi)=>{
                          const answered=candleAns!==null;
                          const correct=oi===CANDLE_QUIZ[candleQ].answer;
                          const chosen=candleAns===oi;
                          let bg=C.panel2,bd=C.line,cl=C.text;
                          if(answered&&correct){bg="rgba(74,222,128,0.12)";bd=C.accent;cl=C.accent;}
                          else if(answered&&chosen&&!correct){bg="rgba(239,68,68,0.12)";bd=C.danger;cl=C.danger;}
                          return (
                            <button key={oi} disabled={answered}
                              onClick={()=>{setCandleAns(oi); if(oi===CANDLE_QUIZ[candleQ].answer)setCandleScore(s=>s+1);}}
                              style={{textAlign:"left",background:bg,border:`1px solid ${bd}`,color:cl,borderRadius:8,padding:"11px 14px",fontSize:13.5,cursor:answered?"default":"pointer",fontFamily:C.sans}}>
                              {opt}{answered&&correct?"  ✓":answered&&chosen?"  ✗":""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {candleAns!==null && (
                    <div style={{marginTop:16,padding:"12px 14px",background:C.panel2,borderRadius:8,fontSize:12.5,color:C.text,lineHeight:1.6}}>
                      {CANDLE_QUIZ[candleQ].explain}
                      <div style={{marginTop:10}}>
                        <button onClick={()=>{setCandleQ(q=>q+1);setCandleAns(null);}} style={{background:C.accent,color:"#08120a",border:"none",borderRadius:8,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                          {candleQ+1<CANDLE_QUIZ.length?"Next →":"See result →"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{fontSize:11,color:C.dim,textAlign:"center",fontFamily:C.mono,lineHeight:1.6,paddingBottom:8}}>
              Candles show what happened — never a guarantee of what's next. Educational only, not advice.
            </div>
          </div>
        ):(
          <div style={{maxWidth:720,margin:"0 auto"}}>
            <div style={{marginBottom:8}}>
              <h2 style={{fontSize:24,fontWeight:800,letterSpacing:-0.5,margin:"0 0 6px"}}>Learn the basics first</h2>
              <p style={{fontSize:14,color:C.dim,lineHeight:1.6,margin:0}}>Plain-language lessons. Understand the tool before you risk anything. Tap any lesson to expand.</p>
            </div>
            <div style={{marginTop:20,display:"flex",flexDirection:"column",gap:10}}>
              {LESSONS.map((l,i)=>(
                <div key={i} style={{background:C.panel,border:`1px solid ${openLesson===i?C.accent:C.line}`,borderRadius:10,overflow:"hidden"}}>
                  <button onClick={()=>setOpenLesson(openLesson===i?null:i)} style={{width:"100%",background:"transparent",border:"none",padding:"15px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",color:C.text}}>
                    <div style={{display:"flex",alignItems:"center",gap:14}}>
                      <span style={{fontFamily:C.mono,fontSize:12,color:C.accent}}>{String(i+1).padStart(2,"0")}</span>
                      <span style={{fontSize:15,fontWeight:600,textAlign:"left"}}>{l.t}</span>
                    </div>
                    <span style={{fontSize:10,fontFamily:C.mono,color:C.dim}}>{l.m} {openLesson===i?"▲":"▼"}</span>
                  </button>
                  {openLesson===i&&(
                    <div style={{padding:"0 18px 18px 44px",fontSize:14,color:C.text,lineHeight:1.7,borderTop:`1px solid ${C.line}`,paddingTop:14,marginTop:0}}>{l.body}</div>
                  )}
                </div>
              ))}
            </div>
            <div style={{marginTop:24,textAlign:"center"}}>
              <button onClick={()=>setTab("trade")} style={{background:C.accent,color:"#08120a",border:"none",borderRadius:8,padding:"12px 26px",fontSize:14,fontWeight:700,cursor:"pointer"}}>Go to the strategy →</button>
            </div>
          </div>
        )}
      </div>

      {/* ── TUTORIAL OVERLAY ── */}
      {showTutorial&&(
        <div style={{position:"fixed",inset:0,background:"rgba(5,8,12,0.82)",backdropFilter:"blur(3px)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:16,maxWidth:460,width:"100%",padding:28,position:"relative"}}>
            <div style={{display:"flex",gap:5,marginBottom:22}}>
              {TUT.map((_,i)=>(
                <div key={i} style={{flex:1,height:3,borderRadius:2,background:i<=tutStep?C.accent:C.line,transition:"background .2s"}}/>
              ))}
            </div>
            <div style={{fontSize:11,fontFamily:C.mono,color:C.accent,letterSpacing:1,marginBottom:10}}>
              STEP {tutStep+1} / {TUT.length}
            </div>
            <h3 style={{fontSize:22,fontWeight:800,letterSpacing:-0.5,margin:"0 0 12px"}}>{TUT[tutStep].title}</h3>
            <p style={{fontSize:14,color:C.dim,lineHeight:1.65,margin:"0 0 24px"}}>{TUT[tutStep].body}</p>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <button onClick={()=>setShowTutorial(false)} style={{background:"none",border:"none",color:C.dim,fontSize:13,cursor:"pointer",fontFamily:C.mono}}>Skip</button>
              <div style={{display:"flex",gap:8}}>
                {tutStep>0&&(
                  <button onClick={()=>setTutStep(tutStep-1)} style={{background:C.panel2,border:`1px solid ${C.line}`,color:C.text,borderRadius:7,padding:"10px 16px",fontSize:13,cursor:"pointer"}}>Back</button>
                )}
                <button onClick={()=>{if(tutStep+1<TUT.length)setTutStep(tutStep+1);else setShowTutorial(false);}} style={{background:C.accent,color:"#08120a",border:"none",borderRadius:7,padding:"10px 18px",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                  {TUT[tutStep].cta}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// FUNNEL (quiz → result → payment) — hands profile to TradeApp
// ═══════════════════════════════════════════════════════════

const QUESTIONS = [
  {
    q: "A position drops 20% in a week. You…",
    opts: [
      { label: "Sell — I can't stomach that", score: 1 },
      { label: "Hold and wait it out", score: 2 },
      { label: "Buy more at the lower price", score: 3 },
    ],
  },
  {
    q: "How long would this money be tied up?",
    opts: [
      { label: "I might need it within months", score: 1 },
      { label: "A year or two", score: 2 },
      { label: "Years — I won't touch it", score: 3 },
    ],
  },
  {
    q: "What's your experience with crypto?",
    opts: [
      { label: "New to it", score: 1 },
      { label: "Bought and held before", score: 2 },
      { label: "I've actively traded", score: 3 },
    ],
  },
  {
    q: "Which outcome sounds more like you?",
    opts: [
      { label: "Steadier ride, smaller swings", score: 1 },
      { label: "A balance of both", score: 2 },
      { label: "Bigger swings for bigger upside", score: 3 },
    ],
  },
  {
    q: "How much of your portfolio is this?",
    opts: [
      { label: "A small slice I can afford to lose", score: 3 },
      { label: "A meaningful chunk", score: 2 },
      { label: "Most of my savings", score: 1 },
    ],
  },
];

// Risk profiles → asset matches (educational framing, volatility-based)
const PROFILES = {
  conservative: {
    name: "Conservative",
    color: C.blue,
    band: "Lower volatility tolerance",
    blurb: "You prioritize capital preservation and steadier movement over big swings. In crypto — an inherently volatile asset class — that means leaning toward the most established, deepest-liquidity assets and smaller position sizes.",
    assets: [
      { sym: "BTC", name: "Bitcoin", why: "Largest, most liquid, least volatile of the majors. The 'blue chip' of crypto.", vol: "Lower (relative)" },
    ],
    strat: "Slower moving-average crossovers (e.g. 20/50) that trade less often and ride longer trends. Fewer signals, less noise.",
  },
  balanced: {
    name: "Balanced",
    color: C.accent,
    band: "Moderate volatility tolerance",
    blurb: "You can sit through drawdowns for better upside, but you're not chasing maximum risk. A mix of the top assets with disciplined rules fits you.",
    assets: [
      { sym: "BTC", name: "Bitcoin", why: "Core, lower-volatility anchor for the portfolio.", vol: "Lower (relative)" },
      { sym: "ETH", name: "Ethereum", why: "Larger swings than BTC, deep liquidity, still established.", vol: "Moderate" },
    ],
    strat: "Balanced crossovers (10/30) with RSI confirmation to filter weak signals. A middle ground between frequency and conviction.",
  },
  aggressive: {
    name: "Aggressive",
    color: C.warn,
    band: "Higher volatility tolerance",
    blurb: "You're comfortable with sharp drawdowns in exchange for larger potential moves, using money you can afford to lose. Higher-volatility assets and more active strategies suit you — with the understanding that bigger swings cut both ways.",
    assets: [
      { sym: "ETH", name: "Ethereum", why: "Established but more volatile than BTC.", vol: "Moderate" },
      { sym: "SOL", name: "Solana", why: "High volatility, sharp trends — bigger upside and bigger drawdowns.", vol: "Higher" },
      { sym: "BNB", name: "BNB", why: "Active mover with strong trends.", vol: "Higher" },
    ],
    strat: "Faster crossovers (5/20) that catch trends early and trade more often. More signals, more noise — demands discipline.",
  },
};

function classify(total, max) {
  const pct = total / max;
  if (pct < 0.45) return "conservative";
  if (pct < 0.72) return "balanced";
  return "aggressive";
}

// ── Conversion tracking helper ──
// Fires events to whatever ad pixels are loaded on the page (Meta, TikTok,
// Google). Safe no-op if a pixel isn't installed. Add the pixel <script>
// tags in index.html; this function routes events to them.
function track(event, data = {}) {
  try {
    if (typeof window === "undefined") return;
    // Meta Pixel
    if (window.fbq) window.fbq("track", event, data);
    // TikTok Pixel
    if (window.ttq) window.ttq.track(event, data);
    // Google (gtag) — map to a generic event
    if (window.gtag) window.gtag("event", event, data);
    // Always leave a console breadcrumb so you can verify in testing
    if (window.console) console.log("[track]", event, data);
  } catch (e) {}
}

// Your Lemon Squeezy checkout link for the Halyo $39 product.
// After payment, set the product's "after purchase" redirect (in Lemon
// Squeezy) to send buyers to https://halyoapp.com so the license gate loads.
const CHECKOUT_URL = "https://planmancorp.lemonsqueezy.com/checkout/buy/46aa0ebf-67d9-4ec6-9a76-41ed05c75bdc";

// Real customer count shown on the hero. Update this ONE number as your
// real total grows (keep it truthful — it reflects actual buyers).
// Later, this can be replaced with a live count pulled from Lemon Squeezy.
const CUSTOMER_COUNT = 1000;

// ═══════════════════════════════════════════════════════════════
// ⚠️⚠️⚠️  TESTING TOGGLE — TURN OFF BEFORE LAUNCH  ⚠️⚠️⚠️
// While this is true, ANYONE can unlock the app on the LIVE site by
// typing the test key  TEST-TEST-TEST-TEST  at the license gate.
// This lets you preview/test on your phone without a real key.
// SET THIS TO false (and push) BEFORE you launch or run ads —
// otherwise the app is free for anyone who knows the test key.
const TESTING_MODE = false;   // ← change to false before launch
const TEST_KEY = "TEST-TEST-TEST-TEST";
// ═══════════════════════════════════════════════════════════════

// Real customer feedback. Keep these genuine — add/rotate as you collect more.
const TESTIMONIALS = [
  { quote: "I have been trading for years, and this app has helped me better understand and manage the risks involved in trading.", name: "Abdul Fayadh", tag: "Financial Analyst" },
  { quote: "So far, this application has suited my needs for learning about cryptocurrency.", name: "Joanne Ng", tag: "Sales Person" },
  { quote: "For those who want to learn, this app can guide you and make it easier to understand market trends.", name: "Ng Choon Wai", tag: "Telemarketer" },
];

// ── Candle patterns (o,h,l,c on a 0-100 scale) + honest explanations ──
const CANDLE_PATTERNS = [
  { name:"Doji", ohlc:{o:50,h:75,l:25,c:51},
    what:"Open and close almost equal — a small body with wicks on both sides.",
    means:"Buyers and sellers fought to a standstill; the market is undecided.",
    honest:"Often called a 'reversal signal,' but on its own a doji predicts very little. It's context (where it appears) that traders read into — and that reading is frequently wrong." },
  { name:"Hammer", ohlc:{o:65,h:70,l:20,c:68},
    what:"Small body near the top, long lower wick — price fell hard then recovered.",
    means:"Sellers pushed price down but buyers stepped back in by the close.",
    honest:"Popular as a 'bottom is in, buy now' signal. In reality it works sometimes and fails often — treating it as a guarantee is how people lose money." },
  { name:"Bullish engulfing", ohlc:{o:40,h:78,l:38,c:74},
    what:"A big up-candle whose body fully covers the previous down-candle's body.",
    means:"Buyers overwhelmed sellers decisively in this period.",
    honest:"Looks powerful, and traders love it — but 'looks powerful' isn't the same as 'price will keep rising.' Test any pattern before trusting it (that's what the Lab is for)." },
  { name:"Long green (bullish)", ohlc:{o:30,h:82,l:28,c:80},
    what:"A large body with the close far above the open, tiny wicks.",
    means:"Strong, one-sided buying through the whole period.",
    honest:"Shows what already happened — strong buying. It says nothing certain about the next candle. Momentum can continue or reverse the very next day." },
  { name:"Long red (bearish)", ohlc:{o:80,h:82,l:20,c:24},
    what:"A large body closing far below the open — heavy selling.",
    means:"Sellers dominated the whole period.",
    honest:"A red candle records selling that already occurred; it is not a reliable prediction that selling continues. Panic-selling on one red candle is a classic beginner mistake." },
];

// Quiz: show a candle, ask what it is
const CANDLE_QUIZ = [
  { ohlc:{o:50,h:75,l:25,c:51}, q:"Open and close are nearly equal, with wicks both sides. What is this?",
    options:["Doji","Hammer","Long green"], answer:0,
    explain:"A doji — open ≈ close. It signals indecision, not a guaranteed reversal." },
  { ohlc:{o:65,h:70,l:20,c:68}, q:"Small body up top, long lower wick. What is this?",
    options:["Long red","Hammer","Doji"], answer:1,
    explain:"A hammer — price dropped then recovered by the close. Often over-hyped as a 'buy' signal." },
  { ohlc:{o:30,h:82,l:28,c:80}, q:"Large body, close far above open, tiny wicks. What is this?",
    options:["Long green (bullish)","Doji","Long red (bearish)"], answer:0,
    explain:"A long green candle — strong buying that period. It shows the past, not the future." },
  { ohlc:{o:80,h:82,l:20,c:24}, q:"Large body, close far below open. What is this?",
    options:["Hammer","Long green","Long red (bearish)"], answer:2,
    explain:"A long red candle — heavy selling. Records what happened; doesn't reliably predict more selling." },
];

function Funnel({ onComplete, onAlreadyBought }) {
  const [stage, setStage] = useState("hero"); // hero | quiz | result | buy
  const [qIdx, setQIdx] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [tIdx, setTIdx] = useState(0); // testimonial carousel index
  useEffect(() => {
    if (stage !== "hero") return;
    const id = setInterval(() => setTIdx((i) => (i + 1) % TESTIMONIALS.length), 5000);
    return () => clearInterval(id);
  }, [stage]);

  const maxScore = QUESTIONS.length * 3;
  const total = answers.reduce((a, b) => a + b, 0);
  const profileKey = useMemo(() => classify(total, maxScore), [total, maxScore]);
  const profile = PROFILES[profileKey];

  const pick = (score) => {
    const next = [...answers, score];
    setAnswers(next);
    if (qIdx + 1 < QUESTIONS.length) setQIdx(qIdx + 1);
    else setStage("result");
  };
  const restart = () => { setAnswers([]); setQIdx(0); setStage("hero"); };

  const Disclaimer = ({ compact }) => (
    <div style={{
      fontSize: compact ? 10 : 11, color: C.dim, lineHeight: 1.6,
      fontFamily: C.sans, maxWidth: 620, margin: compact ? "0" : "0 auto",
    }}>
      <span style={{ color: C.warn, fontWeight: 600 }}>Not financial advice.</span>{" "}
      Halyo is an education and analysis tool. Asset matches reflect your stated risk
      preference, not a recommendation to buy. Crypto is volatile and you can lose money.
      Win rates shown in the app are measured on historical data, after costs — past results
      never guarantee future outcomes. You make every decision.
      <div style={{ marginTop: 10 }}>
        <a href="/risk-disclaimer.html" target="_blank" rel="noopener" style={{ color: C.blue, textDecoration: "none" }}>Risk Disclaimer</a>
        <span style={{ margin: "0 6px", color: C.line }}>·</span>
        <a href="/terms.html" target="_blank" rel="noopener" style={{ color: C.blue, textDecoration: "none" }}>Terms</a>
        <span style={{ margin: "0 6px", color: C.line }}>·</span>
        <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: C.blue, textDecoration: "none" }}>Privacy</a>
      </div>
    </div>
  );

  const Shell = ({ children }) => (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: C.sans }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "22px 22px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>
            Hal<span style={{ color: C.accent }}>yo</span>
          </span>
          <span style={{ fontSize: 10, color: C.dim, fontFamily: C.mono, letterSpacing: 0.5 }}>
            backtest · analyze · decide
          </span>
        </div>
        <div style={{ height: 1, background: C.line, marginBottom: 28 }} />
        {children}
      </div>
    </div>
  );

  // ── HERO ──
  if (stage === "hero") {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "20px 0 8px" }}>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>
            Learn crypto trading without the hype
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.5, margin: "0 0 18px", maxWidth: 680, marginLeft: "auto", marginRight: "auto" }}>
            See how crypto strategies{" "}
            <span style={{ color: C.accent }}>really perform — before you risk anything.</span>
          </h1>
          <p style={{ fontSize: 16, color: C.dim, lineHeight: 1.6, maxWidth: 560, margin: "0 auto 32px" }}>
            Halyo is a learning tool and strategy reality-checker. Take the 2-minute risk
            assessment to find where to start, then learn to read strategies and see honestly
            how they hold up on real data — costs, drawdowns, and all. No signals to follow,
            no promises. Just clear thinking about crypto.
          </p>
          <button onClick={() => { track("StartQuiz"); setStage("quiz"); }} style={{
            background: C.accent, color: "#08120a", border: "none", borderRadius: 8,
            padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer",
            fontFamily: C.sans, letterSpacing: 0.2,
          }}>
            Start the risk assessment →
          </button>
          <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, marginTop: 14 }}>
            Free · no signup · 5 questions
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 18 }}>
            Already purchased?{" "}
            <button onClick={onAlreadyBought} style={{
              background: "none", border: "none", color: C.blue, cursor: "pointer",
              fontSize: 12, textDecoration: "underline", padding: 0, fontFamily: C.sans,
            }}>Enter your license key →</button>
          </div>

          {/* real customer trust count */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 30 }}>
            <div style={{ display: "flex" }}>
              {[0,1,2,3].map((i) => (
                <div key={i} style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: [C.accentDim, C.blue, C.violet, "#e8a24a"][i],
                  border: `2px solid ${C.bg}`, marginLeft: i === 0 ? 0 : -10,
                }} />
              ))}
            </div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text, fontFamily: C.mono }}>
                {CUSTOMER_COUNT.toLocaleString()}+ customers
              </div>
              <div style={{ fontSize: 11, color: C.dim }}>learning to trade more honestly with Halyo</div>
            </div>
          </div>
        </div>

        {/* honest value props */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 48 }}>
          {[
            { k: "01", t: "Costs included", d: "Every win rate is measured after fees and slippage — the number most tools hide." },
            { k: "02", t: "Out-of-sample only", d: "Results shown on data the strategy never trained on. No flattering hindsight." },
            { k: "03", t: "No execution", d: "We don't touch your money or place trades. You trade on your own exchange." },
          ].map((f) => (
            <div key={f.k} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 18 }}>
              <div style={{ fontFamily: C.mono, fontSize: 12, color: C.accent, marginBottom: 10 }}>{f.k}</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{f.t}</div>
              <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.55 }}>{f.d}</div>
            </div>
          ))}
        </div>

        {/* what you get */}
        <div style={{ marginTop: 56 }}>
          <div style={{ textAlign: "center", fontSize: 11, fontFamily: C.mono, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>
            One payment · yours to keep
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
            {[
              { icon: "∞", t: "Lifetime license", d: "Pay once, keep it forever. No subscription, no recurring charges — one key, yours to keep." },
              { icon: "↑", t: "Free updates & patches", d: "As Halyo improves — new lessons, new tools, fixes — your license covers every update at no extra cost." },
              { icon: "◇", t: "Learning-first", d: "Built to make you a sharper, more honest trader — not to sell you signals or take a cut of your money." },
            ].map((f, i) => (
              <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 24, color: C.accent, marginBottom: 10, fontFamily: C.mono }}>{f.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{f.t}</div>
                <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.55 }}>{f.d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* testimonial carousel */}
        <div style={{ marginTop: 56 }}>
          <div style={{ textAlign: "center", fontSize: 11, fontFamily: C.mono, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 20 }}>
            What people are saying
          </div>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "32px 28px", maxWidth: 640, margin: "0 auto", textAlign: "center", minHeight: 150 }}>
            <div style={{ fontSize: 18, lineHeight: 1.6, color: C.text, fontStyle: "italic", marginBottom: 18 }}>
              “{TESTIMONIALS[tIdx].quote}”
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{TESTIMONIALS[tIdx].name}</div>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, marginTop: 2 }}>{TESTIMONIALS[tIdx].tag}</div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
            {TESTIMONIALS.map((_, i) => (
              <button key={i} onClick={() => setTIdx(i)} style={{
                width: 8, height: 8, borderRadius: "50%", border: "none", cursor: "pointer",
                background: i === tIdx ? C.accent : C.line, padding: 0,
              }} />
            ))}
          </div>
        </div>

        {/* founder note */}
        <div style={{ marginTop: 56, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "28px 26px", maxWidth: 680, margin: "56px auto 0" }}>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
            A note from the founder
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: C.text, margin: "0 0 12px" }}>
            I got tired of watching people get burned by crypto “signal” groups — the fake win rates,
            the hidden costs, the countdown timers. So I built the opposite: a tool that shows you
            honestly how strategies really perform, losses and all, and teaches you to think for yourself.
          </p>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: C.dim, margin: 0 }}>
            No hype. No promises. Just an honest look at a space that badly needs one. If that resonates,
            I'd genuinely love your feedback.
          </p>
          <div style={{ fontSize: 13, fontFamily: C.mono, color: C.accent, marginTop: 16 }}>— The Halyo team</div>
        </div>

        {/* contact / support */}
        <div style={{ marginTop: 56, textAlign: "center" }}>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>
            Questions? We're here
          </div>
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "26px 24px", maxWidth: 520, margin: "0 auto" }}>
            <p style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, margin: "0 0 16px" }}>
              Before or after you buy, reach a real person. We usually reply within a day.
            </p>
            <a href="/contact.html" style={{
              display: "inline-block", background: C.accent, color: "#08120a", textDecoration: "none",
              borderRadius: 8, padding: "12px 26px", fontSize: 15, fontWeight: 700,
            }}>Contact us</a>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: C.mono, marginTop: 14 }}>
              Lost your key · refund requests · anything else · or email support@halyoapp.com
            </div>
          </div>
        </div>

        <div style={{ marginTop: 36, textAlign: "center" }}><Disclaimer /></div>
      </Shell>
    );
  }

  // ── QUIZ ──
  if (stage === "quiz") {
    const question = QUESTIONS[qIdx];
    const progress = ((qIdx) / QUESTIONS.length) * 100;
    return (
      <Shell>
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div style={{ height: 4, background: C.line, borderRadius: 2, marginBottom: 32, overflow: "hidden" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: C.accent, transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, marginBottom: 14, letterSpacing: 1 }}>
            QUESTION {qIdx + 1} / {QUESTIONS.length}
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.25, letterSpacing: -0.5, margin: "0 0 28px" }}>
            {question.q}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {question.opts.map((o, i) => (
              <button key={i} onClick={() => pick(o.score)} style={{
                background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10,
                padding: "16px 18px", fontSize: 15, color: C.text, textAlign: "left",
                cursor: "pointer", fontFamily: C.sans, transition: "all .12s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = C.panel2; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.background = C.panel; }}>
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={restart} style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", marginTop: 24, fontFamily: C.mono }}>
            ← start over
          </button>
        </div>
      </Shell>
    );
  }

  // ── RESULT ──
  if (stage === "result") {
    return (
      <Shell>
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
            Your risk profile
          </div>
          <div style={{
            display: "inline-block", fontSize: 34, fontWeight: 800, letterSpacing: -1,
            color: profile.color, marginBottom: 4,
          }}>
            {profile.name}
          </div>
          <div style={{ fontSize: 12, fontFamily: C.mono, color: C.dim }}>{profile.band}</div>
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 22, margin: "24px 0 16px" }}>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: C.text, margin: 0 }}>{profile.blurb}</p>
        </div>

        {/* asset matches — framed as what to STUDY, not what to buy */}
        <div style={{ fontSize: 11, fontFamily: C.mono, color: profile.color, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
          Good assets to learn with at your comfort level
        </div>
        <div style={{ fontSize: 11, color: C.dim, marginBottom: 12, lineHeight: 1.5, maxWidth: 520 }}>
          These aren't buy recommendations — they're the assets whose volatility best matches your stated comfort level, so the lessons and strategy behaviour are easiest to learn from.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
          {profile.assets.map((a) => (
            <div key={a.sym} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 18px", display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{ minWidth: 54 }}>
                <div style={{ fontFamily: C.mono, fontWeight: 700, fontSize: 18, color: profile.color }}>{a.sym}</div>
                <div style={{ fontSize: 10, color: C.dim }}>{a.name}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{a.why}</div>
                <div style={{ fontSize: 10, fontFamily: C.mono, color: C.dim, marginTop: 4 }}>Volatility: {a.vol}</div>
              </div>
            </div>
          ))}
        </div>

        {/* matched strategy */}
        <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 18, marginBottom: 26 }}>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
            Strategy style you'll learn to read
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: C.text }}>{profile.strat}</div>
        </div>

        <div style={{ textAlign: "center" }}>
          <button onClick={() => setStage("buy")} style={{
            background: C.accent, color: "#08120a", border: "none", borderRadius: 8,
            padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}>
            See what's inside the app →
          </button>
          <div>
            <button onClick={restart} style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", marginTop: 16, fontFamily: C.mono }}>
              ← retake assessment
            </button>
          </div>
        </div>

        <div style={{ marginTop: 28, textAlign: "center" }}><Disclaimer /></div>
      </Shell>
    );
  }

  // ── BUY ──
  return (
    <Shell>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontFamily: C.mono, color: C.accent, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
          The {profile.name} plan · built for your profile
        </div>
        <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, margin: "0 0 8px" }}>
          Everything to trade your match with discipline
        </h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20, alignItems: "start" }}>
        {/* what's inside */}
        <div>
          {[
            { t: "Lessons for your level", d: "A structured path from risk basics to reading signals — paced to your assessment, not a generic course." },
            { t: "Your matched strategy", d: `The ${profile.name.toLowerCase()} strategy style, pre-configured for your assets, ready to run.` },
            { t: "Backtested indicators", d: "Each signal shown with its win rate, expectancy, and drawdown — measured after costs, out-of-sample." },
            { t: "Risk shown on every trade", d: "Position-size guidance and the honest downside for each setup, so you're never flying blind." },
          ].map((f, i) => (
            <div key={i} style={{ display: "flex", gap: 14, marginBottom: 18 }}>
              <div style={{ fontFamily: C.mono, fontSize: 12, color: C.accent, paddingTop: 2 }}>
                {String(i + 1).padStart(2, "0")}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{f.t}</div>
                <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.55 }}>{f.d}</div>
              </div>
            </div>
          ))}
        </div>

        {/* price card */}
        <div style={{ background: C.panel, border: `1px solid ${C.accent}`, borderRadius: 14, padding: 24, position: "sticky", top: 20 }}>
          <div style={{ fontSize: 11, fontFamily: C.mono, color: C.dim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            One-time purchase
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 40, fontWeight: 800, fontFamily: C.mono }}>$39</span>
            <span style={{ fontSize: 13, color: C.dim, textDecoration: "line-through", fontFamily: C.mono }}>$59</span>
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 20 }}>
            Pay once. Download the app. Yours to keep.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {["Desktop + mobile app", "Your matched strategy preloaded", "Full lesson library", "Lifetime updates"].map((li) => (
              <div key={li} style={{ display: "flex", gap: 8, fontSize: 13, color: C.text }}>
                <span style={{ color: C.accent }}>✓</span> {li}
              </div>
            ))}
          </div>
          <button onClick={() => {
            // Opens the real Lemon Squeezy checkout for the $39 product.
            // After payment, Lemon Squeezy emails the buyer a license key and
            // (per your product's "after purchase" redirect setting) sends them
            // back to the app, where the license gate unlocks it.
            track("InitiateCheckout", { value: 39, currency: "USD" });
            window.location.href = CHECKOUT_URL;
          }} style={{
            width: "100%", background: C.accent, color: "#08120a", border: "none",
            borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}>
            Get the {profile.name} plan — $39
          </button>
          <div style={{ fontSize: 10, color: C.dim, textAlign: "center", marginTop: 10, fontFamily: C.mono }}>
            Secure checkout via Lemon Squeezy · demo skips real payment
          </div>
        </div>
      </div>

      <div style={{ marginTop: 32, padding: 16, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10 }}>
        <Disclaimer compact />
      </div>

      <div style={{ textAlign: "center" }}>
        <button onClick={restart} style={{ background: "none", border: "none", color: C.dim, fontSize: 12, cursor: "pointer", marginTop: 20, fontFamily: C.mono }}>
          ← back to start
        </button>
      </div>
    </Shell>
  );
}


// ═══════════════════════════════════════════════════════════
// LICENSE GATE — shown after payment. Validates the key against
// the serverless function before unlocking TradeApp.
// ═══════════════════════════════════════════════════════════
// Point this at your deployed function. e.g. "https://halyo.com/api/validate-license"
const VALIDATE_URL = "/api/validate-license";

function LicenseGate({ onUnlock }){
  const [key,setKey]=useState("");
  const [state,setState]=useState("idle"); // idle | checking | error
  const [msg,setMsg]=useState("");

  const submit=async()=>{
    const k=key.trim();
    if(k.length<8){ setState("error"); setMsg("That doesn't look like a valid key."); return; }

    // TESTING TOGGLE — when TESTING_MODE is true (top of file), the test key
    // unlocks the app anywhere, including the live site, so you can preview on
    // your phone. Set TESTING_MODE=false before launch to disable this.
    if(TESTING_MODE && k === TEST_KEY){ onUnlock({ valid:true, dev:true }); return; }

    setState("checking"); setMsg("");
    try{
      const res=await fetch(VALIDATE_URL,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ licenseKey:k, instanceName:"halyo-web" }),
      });
      const data=await res.json();
      if(data.valid){
        // PRODUCTION: persist so they don't re-enter every visit.
        // localStorage isn't available in this sandbox preview, so we
        // guard it; on your real domain this line remembers the unlock.
        try{
          const already = window.localStorage.getItem("halyo_license");
          window.localStorage.setItem("halyo_license", k);
          // Fire Purchase only the first time this key unlocks (not on repeat visits)
          if(!already) track("Purchase", { value: 39, currency: "USD" });
        }catch(e){ track("Purchase", { value: 39, currency: "USD" }); }
        onUnlock(data);
      }else{
        setState("error"); setMsg(data.error||"Invalid or inactive license.");
      }
    }catch(e){
      setState("error"); setMsg("Couldn't reach the license server. Check your connection and try again.");
    }
  };

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:C.sans,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{maxWidth:420,width:"100%",textAlign:"center"}}>
        <div style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,marginBottom:6}}>
          Hal<span style={{color:C.accent}}>yo</span>
        </div>
        <div style={{fontSize:13,color:C.dim,fontFamily:C.mono,marginBottom:28}}>enter your license key to unlock</div>
        {TESTING_MODE && (
          <div style={{background:"rgba(245,158,11,0.12)",border:`1px solid ${C.warn}`,borderRadius:8,padding:"10px 12px",marginBottom:20,fontSize:11.5,color:"#e8c67a",lineHeight:1.5}}>
            ⚠️ TESTING MODE is ON. Type <strong>{TEST_KEY}</strong> to preview. Turn this off before launch.
          </div>
        )}
        <input
          value={key}
          onChange={(e)=>{setKey(e.target.value);setState("idle");}}
          onKeyDown={(e)=>{if(e.key==="Enter")submit();}}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          style={{
            width:"100%",boxSizing:"border-box",background:C.panel2,border:`1px solid ${state==="error"?C.danger:C.line}`,
            color:C.text,borderRadius:8,padding:"14px 16px",fontSize:15,fontFamily:C.mono,textAlign:"center",letterSpacing:1,marginBottom:12,
          }}/>
        <button onClick={submit} disabled={state==="checking"} style={{
          width:"100%",background:C.accent,color:"#08120a",border:"none",borderRadius:8,
          padding:"14px",fontSize:15,fontWeight:700,cursor:state==="checking"?"default":"pointer",opacity:state==="checking"?0.6:1,
        }}>{state==="checking"?"Checking…":"Unlock Halyo"}</button>
        {msg && <div style={{fontSize:12,color:C.danger,marginTop:12,lineHeight:1.5}}>{msg}</div>}
        <div style={{fontSize:11,color:C.dim,marginTop:22,lineHeight:1.6}}>
          Your key was emailed to you after purchase. Can't find it? Check spam, or contact <a href="mailto:support@halyoapp.com" style={{color:C.blue}}>support@halyoapp.com</a>.
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ROOT: funnel (free) → payment → license gate → app.
// ═══════════════════════════════════════════════════════════
export default function App(){
  const [chosenProfile,setChosenProfile]=useState("Balanced");

  // On load, decide the starting screen:
  //  - a saved valid key → straight into the app (returning customer)
  //  - ?unlock=1 in the URL (Lemon Squeezy's post-purchase redirect) → license gate
  //  - otherwise → the funnel (new visitor)
  const [savedKey]=useState(()=>{ try{ return window.localStorage.getItem("halyo_license"); }catch(e){ return null; } });
  const [flow,setFlow]=useState(()=>{
    if(savedKey) return "app";
    try{ if(new URLSearchParams(window.location.search).get("unlock")) return "gate"; }catch(e){}
    return "funnel";
  });

  if(flow==="funnel"){
    return <Funnel
      onAlreadyBought={()=>setFlow("gate")}
      onComplete={(profileKey)=>{
      // classify() returns lowercase ("balanced"); STRATS keys are capitalized
      // ("Balanced"). Normalize so STRATS[profile] always resolves.
      const norm = typeof profileKey==="string" && profileKey.length
        ? profileKey.charAt(0).toUpperCase()+profileKey.slice(1).toLowerCase()
        : "Balanced";
      const safe = ["Conservative","Balanced","Aggressive"].includes(norm) ? norm : "Balanced";
      setChosenProfile(safe);
      setFlow(savedKey ? "app" : "gate");
    }} />;
  }
  if(flow==="gate"){
    return <LicenseGate onUnlock={()=>setFlow("app")} />;
  }
  return <TradeApp initialProfile={chosenProfile} />;
}
