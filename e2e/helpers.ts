import { type Page } from "@playwright/test";
import { TestApiClient } from "./fixtures";

const DEFAULT_E2E_NAME = "E2E User";
const DEFAULT_E2E_EMAIL = "e2e@multica.ai";
const DEFAULT_E2E_WORKSPACE = "e2e-workspace";

interface DefaultSession {
  token: string;
  workspace: { id: string; name: string; slug: string };
}

let defaultSessionPromise: Promise<DefaultSession> | null = null;

async function ensureDefaultSession(): Promise<DefaultSession> {
  if (!defaultSessionPromise) {
    defaultSessionPromise = (async () => {
      const api = new TestApiClient();
      await api.login(DEFAULT_E2E_EMAIL, DEFAULT_E2E_NAME);
      const workspace = await api.ensureWorkspace(
        "E2E Workspace",
        DEFAULT_E2E_WORKSPACE,
      );
      const token = api.getToken();
      if (!token) {
        throw new Error("default E2E login did not return a token");
      }
      return { token, workspace };
    })().catch((err) => {
      defaultSessionPromise = null;
      throw err;
    });
  }
  return defaultSessionPromise;
}

/**
 * Log in as the default E2E user and ensure the workspace exists first.
 * Authenticates via API (send-code → DB read → verify-code), then injects
 * the token into localStorage so the browser session is authenticated.
 *
 * The default session is cached for the Playwright run so parallel tests
 * do not trip per-IP /auth/send-code rate limits.
 *
 * Returns the E2E workspace slug so callers can build workspace-scoped URLs.
 */
export async function loginAsDefault(page: Page): Promise<string> {
  const { token, workspace } = await ensureDefaultSession();

  await page.goto("/login");
  await page.evaluate((t) => {
    localStorage.setItem("multica_token", t);
  }, token);
  await page.goto(`/${workspace.slug}/issues`);
  await page.waitForURL("**/issues", { timeout: 10000 });
  return workspace.slug;
}

/**
 * Create a TestApiClient logged in as the default E2E user.
 * Call api.cleanup() in afterEach to remove test data created during the test.
 */
export async function createTestApi(): Promise<TestApiClient> {
  const { token, workspace } = await ensureDefaultSession();
  const api = new TestApiClient();
  api.adoptSession(token, workspace);
  return api;
}

export async function openWorkspaceMenu(page: Page) {
  // Click the workspace switcher button (has ChevronDown icon)
  await page.locator("aside button").first().click();
  // Wait for dropdown to appear
  await page.locator('[class*="popover"]').waitFor({ state: "visible" });
}
