import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachAdminToken } from "@/lib/admin-token-middleware";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * v2.87: a refused call must fail in the browser. The server answers a missing
 * or wrong admin token with a plain 401 (403 while no ADMIN_TOKEN is set), and
 * the framework hands such a plain answer to the caller as a normal result —
 * so "Proposal dismissed" or "Changes saved" appeared although nothing had
 * been written, and a refused edit opened the "someone else changed this
 * record" dialog. Turning the answer into an error here makes every action
 * report it ("… failed: Unauthorized: missing or wrong admin token").
 */
const refuseAware: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401 || response.status === 403) {
    const text = (await response.text()).trim();
    throw new Error(text || `Request refused (${response.status})`);
  }
  return response;
};

export const startInstance = createStart(() => ({
  functionMiddleware: [attachAdminToken],
  requestMiddleware: [errorMiddleware],
  serverFns: { fetch: refuseAware },
}));
