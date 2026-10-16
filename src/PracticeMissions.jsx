import React, { useMemo, useState } from "react";
import { createSampleData, runBacktest, interpretTest } from "./learning.js";
import { useLearningStore } from "./useLearningStore.js";

const sample = createSampleData();
const pct = n => `${(n * 100).toFixed(1)}%`;
const configuration = fast => ({ fast, slow: 30, costBps: 10, slipBps: 5, useRsi: false });
const valid = value => value && Array.isArray(value.done) && value.done.length === 3 && value.done.every(v => typeof v === "boolean") && Array.isArray(value.notes) && value.notes.length === 3 && value.notes.every(v => typeof v === "string" && v.length <= 500);

export function CandlePair() {
  return <svg viewBox="0 0 200 140" width="200" height="140" role="img" aria-label="Two-candle bullish engulfing example: a smaller red body from 65 to 45 followed by a green body from 35 to 80. It describes past prices, not the next move." style={{maxWidth:"100%"}}>
    <line x1="55" x2="55" y1="32" y2="108" stroke="#ef4444" strokeWidth="3"/>
    <rect x="37" y="55" width="36" height="30" fill="#ef4444" rx="2"/>
    <line x1="137" x2="137" y1="15" y2="118" stroke="#4ade80" strokeWidth="3"/>
    <rect x="115" y="30" width="44" height="70" fill="#4ade80" rx="2"/>
    <text x="55" y="136" fill="#94a3b8" fontSize="11" textAnchor="middle">Previous</text>
    <text x="137" y="136" fill="#94a3b8" fontSize="11" textAnchor="middle">Next</text>
  </svg>;
}

export default function PracticeMissions() {
  const [active, setActive] = useState(0);
  const [saved, setSaved, storageOk] = useLearningStore("halyo_missions_v1", { done: [false, false, false], notes: ["", "", ""] }, valid);
  const [answer, setAnswer] = useState(null);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [fast, setFast] = useState(10);
  const [revealed, setRevealed] = useState(null);
  const low = useMemo(() => runBacktest(sample, { ...configuration(10), costBps: 0, slipBps: 0 }), []);
  const high = useMemo(() => runBacktest(sample, { ...configuration(10), costBps: 50, slipBps: 5 }), []);
  const earlier = useMemo(() => runBacktest(sample.slice(0, 234), configuration(fast)), [fast]);
  const titles = ["Read the candle", "See the cost", "Challenge the result"];
  const pick = correct => {
    setAnswer(correct); setNotice("");
    if (correct) setSaved(v => ({ ...v, done: v.done.map((done, i) => i === active ? true : done) }));
  };
  const changeMission = index => { setActive(index); setAnswer(null); setNotice(""); setNote(saved.notes[index]); };
  return <section className="halyo-missions" aria-labelledby="mission-heading">
    <div className="halyo-kicker">Learn by doing · free guided exercises</div>
    <h2 id="mission-heading">Try a concept. Explain what happened.</h2>
    <p className="halyo-muted">Three short exercises with feedback. All numbers in these exercises use <strong>illustrative sample prices, not market data</strong>. Completion means answering a learning check, not proving trading skill.</p>
    <div className="halyo-mission-tabs" aria-label="Choose an exercise">
      {titles.map((title, i) => <button key={title} aria-pressed={active === i} onClick={() => changeMission(i)}>{saved.done[i] ? "✓ " : `${i + 1}. `}{title}</button>)}
    </div>
    <div className="halyo-mission-body">
      <h3>{titles[active]}</h3>
      {active === 0 && <>
        <div className="halyo-exercise-row"><CandlePair/><p>The green body covers the previous red body. That is a bullish engulfing pattern. Open and close form each body; the wicks show the high and low. What can this pair tell you?</p></div>
        <button className="halyo-choice" onClick={() => pick(false)}>The next candle must rise.</button>
        <button className="halyo-choice" onClick={() => pick(true)}>It describes those two periods; it cannot guarantee the next move.</button>
        {answer !== null && <p role="status">{answer ? "Correct. “Bullish” names the observed shape. It is not a prediction or a reason by itself to trade." : "Look again: these candles record prices that already happened. A shape cannot guarantee what happens next."}</p>}
      </>}
      {active === 1 && <>
        <p>Same sample, same days 1–360, same 10/30 moving-average rule. Only the cost assumption changes.</p>
        <div className="halyo-result-grid">
          <div><span>No costs</span><strong>{pct(low.metrics.totalReturn)}</strong><small>0.00% per side</small></div>
          <div><span>Higher costs</span><strong>{pct(high.metrics.totalReturn)}</strong><small>0.50% fee + 0.05% slippage per side</small></div>
        </div>
        <p>Both include the ending value of an open position. The higher-cost assumption is illustrative, not an exchange quote. Why are these results different?</p>
        <button className="halyo-choice" onClick={() => pick(false)}>The higher-cost run used a different asset.</button>
        <button className="halyo-choice" onClick={() => pick(true)}>Entry and exit costs reduce the proceeds of the same rule.</button>
        {answer !== null && <p role="status">{answer ? "Correct. Keeping the rule and prices fixed isolates the cost effect. A positive historical return would still not establish future profitability." : "The asset, dates and rule stayed fixed. The deliberate change was the cost charged on each side."}</p>}
      </>}
      {active === 2 && <>
        <p>Choose a fast average using only the earlier sample window (days 1–234). Record it before revealing the later window (days 235–360).</p>
        <label className="halyo-field">Fast average: {fast} days · slow average: 30 days
          <input aria-label="Mission fast average" type="range" min="2" max="29" value={fast} onChange={e => { setFast(+e.target.value); setRevealed(null); setAnswer(null); }}/>
        </label>
        <p>Earlier sample return: <strong>{pct(earlier.metrics.totalReturn)}</strong>. Assumed fee 0.10% + slippage 0.05% per side.</p>
        {!revealed ? <button className="halyo-action" onClick={() => {
          const later = runBacktest(sample.slice(234), configuration(fast));
          setRevealed({ fast, earlier, later });
          const record = `Sample prices, MA ${fast}/30. Earlier days 1–234: ${pct(earlier.metrics.totalReturn)}. Later days 235–360: strategy ${pct(later.metrics.totalReturn)}, hold ${pct(later.metrics.buyHold)}. Fee 0.10% + slippage 0.05% per side. Repeated tuning uses hindsight.`;
          setNote(record); setSaved(v => ({ ...v, notes: v.notes.map((text, i) => i === 2 ? record : text) }));
        }}>Record settings & reveal later window</button> : <>
          <div className="halyo-result-grid"><div><span>Later strategy · {revealed.fast}/30</span><strong>{pct(revealed.later.metrics.totalReturn)}</strong></div><div><span>Later buy-and-hold</span><strong>{pct(revealed.later.metrics.buyHold)}</strong></div></div>
          <p>Both cover sample days 235–360 with the same costs. {interpretTest(revealed.earlier, revealed.later)}</p>
          <p>If you change settings after seeing this window, you are using hindsight. What is the sound conclusion?</p>
          <button className="halyo-choice" onClick={() => pick(false)}>Keep tuning this later window until a great result proves the strategy.</button>
          <button className="halyo-choice" onClick={() => pick(true)}>This is one historical example; repeated tuning weakens the test.</button>
          {answer !== null && <p role="status">{answer ? "Correct. Record assumptions, dates and sample size. This exercise is not a forecast or rigorous validation of a trading strategy." : "Once you use the later result to choose settings, it stops being a fresh test. One example cannot prove future performance."}</p>}
        </>}
      </>}
      <label className="halyo-field">Your observation (optional; saved on this browser only)
        <textarea aria-label="Exercise observation" rows="2" maxLength="500" value={note} onChange={e => setNote(e.target.value)} placeholder="What changed? What would this result still not tell you?"/>
      </label>
      <button className="halyo-secondary" onClick={() => { setSaved(v => ({ ...v, notes: v.notes.map((text, i) => i === active ? note : text) })); setNotice("Observation recorded in this browser when storage is available."); }}>Save observation</button>
      {notice && <p role="status">{notice}</p>}
    </div>
    <p className="halyo-muted" aria-live="polite">{saved.done.filter(Boolean).length}/3 learning checks completed. {storageOk ? "Progress and observations stay on this browser, not in a cloud account. Clearing browser data removes them." : "Browser storage is unavailable. Progress lasts only while this page stays open."}</p>
  </section>;
}
