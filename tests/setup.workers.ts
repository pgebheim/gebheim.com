import { beforeEach } from "vitest";
import { reset } from "cloudflare:test";

// @cloudflare/vitest-pool-workers 0.22 removed the automatic per-test
// storage reset that earlier versions performed through the loopback
// service. The suites in this project assume isolated Durable Object
// storage per test, so reset explicitly.
beforeEach(async () => {
  await reset();
});
