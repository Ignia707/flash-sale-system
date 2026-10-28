// Prints the numbers that matter from a k6 summary file: node report.mjs results/replicas-3.json
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(process.argv[2], "utf8"));
// k6 versions differ: values are either under .values or directly on the metric
const m = (name) => data.metrics[name]?.values ?? data.metrics[name] ?? {};
const count = (name) => m(name).count ?? 0;
const ms = (x) => (x === undefined ? "-" : x.toFixed(1));

const total = count("http_reqs");
const seconds = data.state?.testRunDurationMs ? data.state.testRunDurationMs / 1000 : undefined;
const latency = m("http_req_duration");

console.log(`requests sent:        ${total}`);
console.log(`dropped (not sent):   ${count("dropped_iterations")}`);
if (seconds) console.log(`test duration:        ${seconds.toFixed(1)} s  (${Math.round(total / seconds)} requests/s achieved)`);
console.log(`answers 202 accepted: ${count("answers_202_accepted")}`);
console.log(`answers 409 duplicate:${count("answers_409_duplicate")}`);
console.log(`answers 410 sold out: ${count("answers_410_sold_out")}`);
console.log(`unexpected answers:   ${count("answers_unexpected")}`);
console.log(`latency ms: avg ${ms(latency.avg)} | median ${ms(latency.med)} | p90 ${ms(latency["p(90)"])} | p95 ${ms(latency["p(95)"])} | p99 ${ms(latency["p(99)"])} | max ${ms(latency.max)}`);
console.log(`k6 thresholds:        ${Object.values(data.metrics).every((x) => !x.thresholds || Object.values(x.thresholds).every((t) => (typeof t === "object" ? t.ok : t === false ? false : true))) ? "passed" : "FAILED"}`);
