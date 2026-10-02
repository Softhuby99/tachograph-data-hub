// v2.53: one request to the web server right after the container starts.
// Nitro loads the app's server entry on the first request; the daily update
// scheduler starts with it. Without this, a restart at night would leave the
// scheduler idle until someone opens the page. Retries for up to 5 minutes,
// then exits; it never affects the web server itself.
import http from "node:http";
import https from "node:https";

const port = Number(process.env.PORT || 443);
const tls = !!process.env.NITRO_SSL_CERT;
const client = tls ? https : http;
const deadline = Date.now() + 5 * 60 * 1000;

function ping() {
  return new Promise((resolve) => {
    const req = client.get(
      {
        host: "127.0.0.1",
        port,
        path: "/api/public/health",
        timeout: 10000,
        // localhost call to our own server; the certificate is issued for the
        // public host name, not 127.0.0.1.
        rejectUnauthorized: false,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode && res.statusCode < 500);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() < deadline) {
    if (await ping()) {
      console.log("[warmup] web server answered — scheduler started");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error("[warmup] web server did not answer within 5 minutes");
  process.exit(0);
})();
