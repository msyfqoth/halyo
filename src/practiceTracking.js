// One tracker instance per browser page load, shared across demo remounts.
// Only explicit free-demo actions call this; restored progress is not an action.
export function createPracticeTracker(send) {
  const started = new Set();
  const completed = new Set();
  const ids = new Set(["candle", "cost", "challenge"]);
  const emit = (event, practiceId) => {
    try {
      send(event, {
        practice_id: practiceId,
        placement: "demo",
        data_source: "illustrative_sample",
        sample_mode: true,
        event_schema_version: 1,
      });
    } catch { /* Analytics must not interrupt learning. */ }
  };
  return (practiceId, correct = false) => {
    if (!ids.has(practiceId)) return;
    if (!started.has(practiceId)) {
      started.add(practiceId);
      emit("practice_start", practiceId);
    }
    if (correct === true && !completed.has(practiceId)) {
      completed.add(practiceId);
      emit("practice_complete", practiceId);
    }
  };
}
