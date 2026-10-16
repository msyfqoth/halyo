import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const app=fs.readFileSync(new URL("../src/App.jsx",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
test("release retains direct checkout, approved learner count and genuine testimonials",()=>{
  assert.match(app,/const LEARNER_COUNT = 11358/);
  assert.match(app,/Reached through our marketing activities/);
  assert.match(app,/46aa0ebf-67d9-4ec6-9a76-41ed05c75bdc/);
  assert.match(app,/const OFFER_PRICE_USD = 39/);
  assert.match(app,/const TESTING_MODE = false/);
  assert.match(app,/Abdul Fayadh/);assert.match(app,/Sandeep Kumar/);
});
test("Google destinations and native checkout anchor remain present",()=>{
  assert.match(html,/gtag\('config', 'G-85ZCNXLSDS'\)/);
  assert.match(html,/gtag\('config', 'AW-18499104388'\)/);
  assert.match(app,/begin_checkout/);assert.match(app,/<a href=\{CHECKOUT_URL\} className="halyo-checkout"/);
});
test("Google events retain the checkout mapping and reject fabricated purchases",()=>{
  const events=[];const context={window:{location:{hostname:"halyoapp.com"},gtag:(...args)=>events.push(args)},OFFER_PRICE_USD:39};
  const fn=vm.runInNewContext(app.slice(app.indexOf("function trackGoogle("),app.indexOf("function track(event"))+";trackGoogle",context);
  fn("InitiateCheckout",{value:39,currency:"USD"});fn("purchase",{value:39});
  assert.equal(events.length,1);assert.equal(events[0][1],"begin_checkout");assert.equal(events[0][2].send_to,"G-85ZCNXLSDS");
  assert.equal(events[0][2].items[0].price,39);
  context.window.location.hostname="deploy-preview.example";fn("demo_complete");assert.equal(events.length,1);
});
