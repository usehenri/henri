---
'@usehenri/disk': patch
---

Each process gets a starting port of its own for mongod, and `port` in the store configuration names one.

mongodb-memory-server finds a port by binding one with `listen(0)`, closing that probe and then launching mongod on it. Nothing holds the port in between, the cache of ports it has already handed out lives in one process, and both Linux and macOS allocate ephemeral ports in order — so two processes booting a disk store at the same moment probed the same region of the range within milliseconds of each other and the second mongod died with `Port "<n>" already in use`, which the library does not retry. It hit anyone running suites in parallel workers: test runners, a monorepo building several applications, an application whose suite runs beside it.

The adapter now asks for a port derived from the process id, in 20000–26999 — below the ephemeral range of both kernels, so it is never one they are about to hand to something else. Sibling processes have consecutive pids and therefore distinct ports, and the library still falls back to its own search if the port is genuinely taken. `stores.<name>.port` names a fixed port instead, and that one is used as given so the store stays reachable where the application says it is.
