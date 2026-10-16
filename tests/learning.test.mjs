import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest, interpretTest, joinedEquity, createSampleData, emptyPaper, buyPaper, sellPaper, validPaper, readLearningStore, validProgress } from "../src/learning.js";

const cfg = { fast: 2, slow: 3, costBps: 0, slipBps: 0, useRsi: false };
const rows = values => values.map((close, t) => ({ t, close, open: close }));
const almost = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test("open position: headline equals ending curve and includes marked profit", () => {
  const result = runBacktest(rows([5, 4, 3, 2, 3, 4, 5, 6, 7]), cfg);
  assert.equal(result.metrics.nTrades, 0); assert.equal(result.metrics.openPosition, true);
  almost(result.metrics.totalReturn, 0.4); almost(result.equitySeries.at(-1).equity - 1, 0.4);
  almost(result.metrics.realizedReturn, 0);
});
test("next-bar fill does not leak tomorrow's entry into yesterday's equity", () => {
  const input = rows([5, 4, 3, 2, 3, 4, 5, 6, 7]); input[6].open = 10;
  const result = runBacktest(input, cfg);
  almost(result.equitySeries[5].equity, 1); almost(result.equitySeries[6].equity, 0.5);
  almost(result.metrics.totalReturn, -0.3);
});
test("closed round trip uses next open on both sides", () => {
  const input = rows([5,4,3,2,3,4,5,6,7,6,5,4,3]);
  const result = runBacktest(input, cfg);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryT, 6); assert.equal(result.trades[0].exitT, 11);
  almost(result.trades[0].entryPrice, 5); almost(result.trades[0].exitPrice, 4);
  almost(result.metrics.totalReturn, -0.2);
});
test("missing next open explicitly falls back to next close", () => {
  const input = rows([5,4,3,2,3,4,5,6,7]).map(({t,close})=>({t,close}));
  almost(runBacktest(input,cfg).metrics.totalReturn,0.4);
});
test("per-side fees and slippage affect both strategy liquidation and benchmark", () => {
  const result = runBacktest(rows([5,4,3,2,3,4,5,6,7]), {...cfg,costBps:10,slipBps:5});
  almost(result.metrics.totalReturn, 7 * 0.9985 / (5 * 1.0015) - 1);
  almost(result.metrics.buyHold, 7 * 0.9985 / (5 * 1.0015) - 1);
});
test("fixed-rule cost experiment changes costs, not signals or dates", () => {
  const sample=createSampleData(); const settings={fast:10,slow:30,useRsi:false};
  const a=runBacktest(sample,{...settings,costBps:0,slipBps:0});
  const b=runBacktest(sample,{...settings,costBps:50,slipBps:5});
  assert.deepEqual(a.trades.map(t=>[t.entryT,t.exitT]),b.trades.map(t=>[t.entryT,t.exitT]));
  assert.ok(b.metrics.totalReturn<a.metrics.totalReturn);
});
test("verdict compares the later return only with its own benchmark", () => {
  const earlier={metrics:{totalReturn:0.1,buyHold:0.9}};
  const later={metrics:{totalReturn:0.2,buyHold:0.1,nTrades:7}};
  assert.match(interpretTest(earlier,later),/matched or exceeded/);
  assert.match(interpretTest(earlier,{metrics:{...later.metrics,buyHold:0.3}}),/less than/);
});
test("few-trade and changing-period messages do not assert proven overfitting", () => {
  assert.match(interpretTest({metrics:{totalReturn:0.2}},{metrics:{totalReturn:0.1,buyHold:0,nTrades:2}}),/too little evidence/);
  assert.match(interpretTest({metrics:{totalReturn:0.2}},{metrics:{totalReturn:-0.1,buyHold:0,nTrades:7}}),/cannot identify the cause/);
});
test("illustrative linked windows do not silently reset the plotted capital", () => {
  assert.deepEqual(joinedEquity({equitySeries:[{t:1,equity:1.2}]},{equitySeries:[{t:2,equity:1.1}]}),[{t:1,equity:1.2},{t:2,equity:1.32}]);
});
test("empty data and flat data produce finite neutral metrics", () => {
  almost(runBacktest([],cfg).metrics.totalReturn,0);
  const result=runBacktest(rows(Array(40).fill(5)),cfg);
  assert.equal(result.metrics.nTrades,0); almost(result.metrics.totalReturn,0); almost(result.metrics.maxDD,0);
});
test("paper buy preserves unallocated cash and charges disclosed costs", () => {
  const value=buyPaper(emptyPaper(),{asset:"A",price:100,amount:1000,reason:"Learning",source:"sample"});
  assert.equal(value.cash,9000); assert.ok(validPaper(value));
  const closed=sellPaper(value,{asset:"A",price:100,source:"sample"});
  almost(closed.cash,9000+1000*0.9985/1.0015); assert.ok(closed.log[0].pnl<0);
});
test("paper position cannot use another asset or switch sample/market source", () => {
  const value=buyPaper(emptyPaper(),{asset:"A",price:100,amount:1000,source:"sample"});
  assert.throws(()=>sellPaper(value,{asset:"B",price:50000,source:"sample"}));
  assert.throws(()=>sellPaper(value,{asset:"A",price:100,source:"Binance"}));
  assert.throws(()=>buyPaper(emptyPaper(),{asset:"A",price:100,amount:10001,source:"sample"}));
  assert.throws(()=>buyPaper(emptyPaper(),{asset:"A",price:100,amount:1000,stop:110,source:"sample"}));
});
test("versioned journal and progress survive a JSON storage round trip", () => {
  const journal=buyPaper(emptyPaper(),{asset:"A",price:100,amount:1000,reason:"A reason",source:"sample"});
  const storage={getItem:()=>JSON.stringify({version:1,value:journal})};
  assert.deepEqual(readLearningStore(storage,"test",emptyPaper(),validPaper),journal);
  assert.deepEqual(readLearningStore({getItem:()=>JSON.stringify({version:1,value:{lesson:true}})},"test",{},validProgress),{lesson:true});
});
test("blocked storage, malformed data and unknown versions safely fall back", () => {
  for(const storage of [{getItem:()=>"broken"},{getItem:()=>'{"version":2,"value":{}}'},{getItem:()=>'{"version":1,"value":{"cash":-1}}'},{getItem:()=>{throw Error("blocked");}}]) assert.deepEqual(readLearningStore(storage,"test",emptyPaper(),validPaper),emptyPaper());
});
