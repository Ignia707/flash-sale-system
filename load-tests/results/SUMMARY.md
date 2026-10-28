# Load test results

**Scenario:** 100,000 purchase attempts in 10 seconds (10,000 per second, each from a different visitor) for 500 phones, through NGINX.
**Machine:** one 16-core desktop running everything at once: k6, NGINX, the API replicas, the worker, Redis, RabbitMQ and Postgres. Numbers are therefore lower than a real deployment would give, and single runs vary by some percent.
**Settings:** `LOG_LEVEL=warn`, NGINX per-IP rate limits raised (k6 sends from one address), k6 inside the container network.

| API replicas | Requests sent | Not sent (k6 could not keep the rate) | Phones sold | Unexpected answers | Latency p95 | Latency p99 | Latency max |
|---|---|---|---|---|---|---|---|
| 1 | 99,306 | 695 | 500 | 0 | 22.3 ms | 1341 ms | 1558 ms |
| 2 | 100,001 | 0 | 500 | 0 | 13.1 ms | 316 ms | 489 ms |
| 3 | 99,955 | 46 | 500 | 0 | 7.2 ms | 629 ms | 686 ms |
| 4 | 100,001 | 0 | 500 | 0 | 4.5 ms | 329 ms | 402 ms |
| 6 | 100,002 | 0 | 500 | 0 | 6.6 ms | 109 ms | 430 ms |
| 8 | 99,114 | 888 | 500 | 0 | 52.6 ms | 182 ms | 329 ms |

**After every run** the database was checked: exactly 500 confirmed orders, stock 0 in Postgres and in Redis, no failed orders, nothing in the dead-letter queue. No run oversold.

**Reading the table**
- Correctness never depended on the replica count: always exactly 500.
- One replica barely holds the full rate (695 attempts could not even be sent, p99 above one second).
- From 2 to 6 replicas the system handles the full 10,000 requests/s. The slowest 1% (p99) is the noisiest number: it was lowest with 6 replicas but varied a lot between runs, so only the 1-replica result (over one second) is clearly worse.
- 8 replicas is worse than 4 to 6: the machine has no spare CPU, so more processes only compete. More replicas help only while there are free cores (or more machines).
- Median latency stays at 0.2 to 0.3 ms in every run; the slow requests are the few that arrive in the first moments of the spike while connections are being opened.

Per-run details are in `replicas-N.txt`.
