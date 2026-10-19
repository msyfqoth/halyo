// Educational simulations. No exchange orders or investment recommendations.
export function sma(data, period) {
  const out = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rsi(data, period = 14) {
  const out = new Array(data.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    if (i <= period) {
      gain += Math.max(0, change); loss += Math.max(0, -change);
      if (i === period) { gain /= period; loss /= period; }
    } else {
      gain = (gain * (period - 1) + Math.max(0, change)) / period;
      loss = (loss * (period - 1) + Math.max(0, -change)) / period;
    }
    if (i >= period) out[i] = gain === 0 && loss === 0 ? 50 : 100 - 100 / (1 + gain / (loss || 1e-9));
  }
  return out;
}

export function runBacktest(data, cfg) {
  const { fast, slow, rsiFloor, rsiCeil, useRsi, trendFilter } = cfg;
  const fastMA = sma(data, fast), slowMA = sma(data, slow), rsiArr = rsi(data);
  const trendMA = trendFilter ? sma(data, 100) : null;
  const cost = ((cfg.costBps || 0) + (cfg.slipBps || 0)) / 10000;
  let position = null, pending = null, cashEquity = 1;
  const equitySeries = [], trades = [];
  for (let i = 0; i < data.length; i++) {
    // A signal at yesterday's close can fill only on this bar, never earlier.
    const price = data[i].open ?? data[i].close;
    if (pending === "buy") position = { price: price * (1 + cost), index: i };
    if (pending === "sell" && position) {
      const exitPrice = price * (1 - cost), ret = exitPrice / position.price - 1;
      cashEquity *= 1 + ret;
      trades.push({ entryT: data[position.index].t, exitT: data[i].t, entryPrice: position.price, exitPrice, ret, bars: i - position.index });
      position = null;
    }
    pending = null;
    // Net liquidation value includes the assumed exit cost on an open position.
    equitySeries.push({ t: data[i].t, equity: position ? cashEquity * data[i].close * (1 - cost) / position.price : cashEquity });
    const f = fastMA[i], s = slowMA[i], pf = fastMA[i - 1], ps = slowMA[i - 1];
    if (i + 1 < data.length && f != null && s != null && pf != null && ps != null) {
      const rsiOk = !useRsi || (rsiArr[i] != null && rsiArr[i] > rsiFloor && rsiArr[i] < rsiCeil);
      const trendOk = !trendFilter || (trendMA[i] != null && data[i].close > trendMA[i]);
      if (!position && pf <= ps && f > s && rsiOk && trendOk) pending = "buy";
      else if (position && pf >= ps && f < s) pending = "sell";
    }
  }
  const wins = trades.filter(t => t.ret > 0), losses = trades.filter(t => t.ret <= 0);
  const grossWin = wins.reduce((a, t) => a + t.ret, 0), grossLoss = Math.abs(losses.reduce((a, t) => a + t.ret, 0));
  let peak = 1, maxDD = 0;
  const rets = [];
  for (let i = 0; i < equitySeries.length; i++) {
    const equity = equitySeries[i].equity;
    peak = Math.max(peak, equity); maxDD = Math.min(maxDD, equity / peak - 1);
    if (i) rets.push(equity / equitySeries[i - 1].equity - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  const buyHold = data.length ? data.at(-1).close * (1 - cost) / (data[0].close * (1 + cost)) - 1 : 0;
  return { equitySeries, trades, fastMA, slowMA, rsiArr, metrics: {
    totalReturn: (equitySeries.at(-1)?.equity ?? 1) - 1,
    realizedReturn: cashEquity - 1, openPosition: !!position, buyHold,
    winRate: trades.length ? wins.length / trades.length : 0,
    expectancy: trades.length ? trades.reduce((a, t) => a + t.ret, 0) / trades.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    maxDD, sharpe: sd ? mean / sd * Math.sqrt(365) : 0, nTrades: trades.length,
  } };
}

// Fixed parameters across sequential segments, NOT walk-forward optimisation.
export function walkForward(data, cfg, folds = 5) {
  if (data.length < folds * 30) folds = Math.max(2, Math.floor(data.length / 40));
  const size = Math.floor(data.length / folds), windows = [], allTrades = [];
  for (let k = 0; k < folds; k++) {
    const slice = data.slice(k * size, k === folds - 1 ? data.length : (k + 1) * size);
    if (slice.length < 25) continue;
    const bt = runBacktest(slice, cfg);
    windows.push({ idx: k + 1, from: slice[0].t, to: slice.at(-1).t, winRate: bt.trades.length ? bt.metrics.winRate : null, nTrades: bt.metrics.nTrades, ret: bt.metrics.totalReturn, maxDD: bt.metrics.maxDD });
    allTrades.push(...bt.trades);
  }
  const wins = allTrades.filter(t => t.ret > 0), losses = allTrades.filter(t => t.ret <= 0);
  const grossWin = wins.reduce((a, t) => a + t.ret, 0), grossLoss = Math.abs(losses.reduce((a, t) => a + t.ret, 0));
  const profitableWindows = windows.filter(w => w.ret > 0).length;
  return { windows, agg: { winRate: allTrades.length ? wins.length / allTrades.length : 0, nTrades: allTrades.length,
    expectancy: allTrades.length ? allTrades.reduce((a, t) => a + t.ret, 0) / allTrades.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    totalReturn: windows.reduce((value, w) => value * (1 + w.ret), 1) - 1,
    profitableWindows, totalWindows: windows.length, consistency: windows.length ? profitableWindows / windows.length : 0 } };
}

export function interpretTest(earlier, later) {
  if (!earlier || !later) return "Adjust a setting to explore the result.";
  if (later.metrics.nTrades < 5) return "Fewer than five closed trades in the later window: too little evidence for a strong conclusion. Open positions are included in return, not in win rate.";
  const tr = earlier.metrics.totalReturn, te = later.metrics.totalReturn, bh = later.metrics.buyHold;
  if (tr > 0.15 && te <= 0) return "The earlier window gained, but the later window lost. This may reflect changing conditions or overfitting; this result alone cannot identify the cause.";
  if (te < bh) return "The strategy returned less than buying and holding over these SAME later dates, with the same per-side cost assumption. One comparison does not establish what will happen next.";
  return "The strategy matched or exceeded buy-and-hold over these SAME later dates, with the same per-side cost assumption. A single historical window is not proof; repeatedly tuning against it introduces hindsight.";
}

export function joinedEquity(earlier, later) {
  if (!earlier || !later) return [];
  const ending = earlier.equitySeries.at(-1)?.equity ?? 1;
  return [...earlier.equitySeries, ...later.equitySeries.map(row => ({ ...row, equity: row.equity * ending }))];
}

export function createSampleData() {
  return Array.from({ length: 360 }, (_, i) => {
    const price = n => 100 + n * 0.08 + Math.sin(n / 8) * 9 + Math.sin(n / 23) * 6;
    return { i, t: i, open: price(Math.max(0, i - 1)), close: price(i) };
  });
}

// Storage is device-local, optional and versioned. Never handles licence keys.
export function readLearningStore(storage, key, fallback, validate) {
  try { const item = JSON.parse(storage.getItem(key)); return item?.version === 1 && validate(item.value) ? item.value : fallback; }
  catch { return fallback; }
}

export const validProgress = value => value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([k, v]) => k.length < 100 && typeof v === "boolean");
export const emptyPaper = () => ({ cash: 10000, position: null, log: [] });
const positive = n => Number.isFinite(n) && n > 0;
export function validPaper(value) {
  if (!value || !Number.isFinite(value.cash) || value.cash < 0 || !Array.isArray(value.log) || value.log.length > 30) return false;
  const p = value.position;
  if (p && !(typeof p.asset === "string" && positive(p.entryPrice) && positive(p.units) && positive(p.spent) && typeof p.reason === "string" && p.reason.length <= 500 && typeof p.source === "string")) return false;
  return value.log.every(t => typeof t.asset === "string" && typeof t.reason === "string" && t.reason.length <= 500 && Number.isFinite(t.pnl) && Number.isFinite(t.pnlPct) && typeof t.source === "string");
}

export function buyPaper(state, { asset, price, amount, reason = "", stop = null, source }) {
  if (state.position || !positive(price) || !positive(amount) || amount > state.cash || !asset || !source || (stop != null && (!positive(stop) || stop >= price))) throw new Error("Choose an available amount and a reminder price below the entry price.");
  const entryPrice = price * 1.0015;
  return { ...state, cash: state.cash - amount, position: { asset, entryPrice, units: amount / entryPrice, spent: amount, reason: reason.slice(0, 500), stop, source } };
}

export function sellPaper(state, { asset, price, source }) {
  const p = state.position;
  if (!p || p.asset !== asset || p.source !== source || !positive(price)) throw new Error("Use the original asset and data source to close this practice position.");
  const proceeds = p.units * price * 0.9985, pnl = proceeds - p.spent;
  return { cash: state.cash + proceeds, position: null, log: [{ asset, entry: p.entryPrice, exit: price * 0.9985, pnl, pnlPct: pnl / p.spent * 100, reason: p.reason, source, when: Date.now() }, ...state.log].slice(0, 30) };
}
