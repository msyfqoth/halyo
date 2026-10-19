import React, { useState } from "react";
import { emptyPaper, validPaper, buyPaper, sellPaper } from "./learning.js";
import { useLearningStore } from "./useLearningStore.js";

export default function PaperPractice({ asset, price, source, onSelectAsset }) {
  const [paper, setPaper, storageOk] = useLearningStore("halyo_paper_v1", emptyPaper, validPaper);
  const [allocation, setAllocation] = useState(10);
  const [reason, setReason] = useState("");
  const [stop, setStop] = useState("");
  const [error, setError] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const p = paper.position;
  const sameMarket = !p || (p.asset === asset && p.source === source);
  const usable = sameMarket && Number.isFinite(price) && price > 0;
  const marked = p && usable ? p.units * price * 0.9985 : 0;
  const amount = paper.cash * allocation / 100;
  const act = action => { try { setPaper(action()); setError(""); setClearArmed(false); } catch (e) { setError(e.message); } };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ kind: "Halyo educational practice journal", version: 1, ...paper }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "halyo-practice-journal.json"; a.click(); URL.revokeObjectURL(url);
  };
  return <section className="halyo-missions" aria-labelledby="paper-heading">
    <div className="halyo-kicker">Fake funds · deliberate practice</div>
    <h2 id="paper-heading">Practise a decision. Keep your reasoning.</h2>
    <p>Start with $10,000 of virtual funds. Choose an allocation instead of spending the entire balance. This is a basic buy/sell exercise, not a broker simulator.</p>
    <p className="halyo-muted">{source === "sample" ? "Illustrative sample prices — not market data." : `Latest available daily close · ${source}. Not a streaming execution price.`} Assumed costs: 0.10% fee + 0.05% slippage per side. A stop reminder never executes automatically.</p>
    <div className="halyo-result-grid"><div><span>Cash (fake)</span><strong>${paper.cash.toFixed(2)}</strong></div><div><span>Total after assumed exit cost</span><strong>{usable ? `$${(paper.cash + marked).toFixed(2)}` : "Choose original asset/source"}</strong></div></div>
    {p && !sameMarket ? <div role="status"><p>Your open position is {p.asset} using {p.source} prices. Other assets or data sources cannot value or close it.</p><button className="halyo-secondary" onClick={() => onSelectAsset(p.asset)}>Return to {p.asset}</button></div> : p ? <>
      <p>Holding {p.asset} · reason: {p.reason || "No reason recorded"}</p>
      <p>Entry after costs: ${p.entryPrice.toFixed(4)}. {usable ? `Current net P&L: $${(marked - p.spent).toFixed(2)}.` : "Price unavailable."}</p>
      {p.stop && <p>Stop reminder: ${p.stop}. {usable && price <= p.stop ? "Price is at or below this reminder. No order has been executed." : "You must decide whether to close manually."}</p>}
      <button className="halyo-action" disabled={!usable} onClick={() => act(() => sellPaper(paper, { asset, price, source }))}>Close practice position</button>
    </> : <>
      <label className="halyo-field">Allocate {allocation}% of remaining fake cash (${amount.toFixed(2)})
        <input aria-label="Practice allocation" type="range" min="1" max="25" value={allocation} onChange={e => setAllocation(+e.target.value)}/>
      </label>
      <p className="halyo-muted">Allocation is position value, not the percentage you could lose. This exercise does not enforce a risk limit.</p>
      <label className="halyo-field">Why are you considering this practice trade?
        <textarea aria-label="Practice reason" rows="2" maxLength="500" value={reason} onChange={e => setReason(e.target.value)}/>
      </label>
      <label className="halyo-field">Optional stop reminder below entry (no automatic execution)
        <input aria-label="Stop reminder" type="number" min="0" step="any" value={stop} onChange={e => setStop(e.target.value)}/>
      </label>
      <button className="halyo-action" disabled={!usable || !amount} onClick={() => act(() => { const next = buyPaper(paper, { asset, price, amount, reason, stop: stop === "" ? null : Number(stop), source }); setReason(""); setStop(""); return next; })}>Practice buy {asset} · fake funds</button>
    </>}
    {error && <p role="alert">{error}</p>}
    <h3>Your practice journal</h3>
    {!paper.log.length && <p className="halyo-muted">Closed practice trades appear here, including your recorded reason and data source.</p>}
    {paper.log.map((row, i) => <article className="halyo-journal-entry" key={`${row.when}-${i}`}><strong>{row.asset} · {row.pnlPct.toFixed(2)}% simulated</strong><p>{row.reason || "No reason recorded"}</p><small>{row.source} · {new Date(row.when).toLocaleDateString()} · after assumed costs</small></article>)}
    <p className="halyo-muted">{storageOk ? "Saved on this browser only; no cloud sync. Clearing browser data removes it." : "Browser storage is unavailable; this session will not survive a refresh."} Up to 30 closed trades retained. Download a copy before clearing.</p>
    <div className="halyo-mission-tabs"><button onClick={download}>Download practice journal</button><button onClick={() => { if (clearArmed) { setPaper(emptyPaper()); setClearArmed(false); } else setClearArmed(true); }}>{clearArmed ? "Confirm reset: clear local journal and position" : "Reset fake balance & journal"}</button>{clearArmed && <button onClick={() => setClearArmed(false)}>Cancel reset</button>}</div>
  </section>;
}
