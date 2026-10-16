import { useState, useEffect } from "react";
import { readLearningStore } from "./learning.js";

export function useLearningStore(key, initial, validate) {
  const [value, setValue] = useState(() => {
    const fallback = typeof initial === "function" ? initial() : initial;
    try { return readLearningStore(window.localStorage, key, fallback, validate); } catch { return fallback; }
  });
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    try { window.localStorage.setItem(key, JSON.stringify({ version: 1, value })); setAvailable(true); }
    catch { setAvailable(false); }
  }, [key, value]);
  return [value, setValue, available];
}
