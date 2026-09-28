import type { Config } from "./config.js";

export class FundApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "FundApiError";
  }
}

export class FundApiClient {
  private readonly authorization: string;

  constructor(private readonly config: Config) {
    this.authorization = `Basic ${Buffer.from(
      `${config.FUND_API_USERNAME}:${config.FUND_API_PASSWORD}`,
    ).toString("base64")}`;
  }

  private async request<T>(method: string, path: string, authenticated = true): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.FUND_API_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.FUND_API_BASE_URL}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(authenticated ? { Authorization: this.authorization } : {})
        }
      });
      if (!response.ok) {
        throw new FundApiError(response.status, `Fund API returned HTTP ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof FundApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new FundApiError(504, "Fund API request timed out");
      }
      throw new FundApiError(502, "Fund API is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  statistics() {
    return this.request<Record<string, unknown>>("GET", "/admin/statistics");
  }

  expenseReport(from?: string, to?: string) {
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<Record<string, unknown>>("GET", `/admin/reports/expenses${suffix}`);
  }

  memberPaymentHistory(code: string, year?: number) {
    const query = new URLSearchParams({ memberCode: code });
    if (year) query.set("year", String(year));
    return this.request<Record<string, unknown>>(
      "GET",
      `/public/payment-history?${query.toString()}`,
      false,
    );
  }

  reconciliationQueue(page = 0, size = 25) {
    const query = new URLSearchParams({ page: String(page), size: String(size) });
    return this.request<Record<string, unknown>>(
      "GET",
      `/admin/reconciliation/review?${query.toString()}`,
    );
  }

  ingestionStatus() {
    return this.request<Record<string, unknown>>("GET", "/admin/ingestion/status");
  }

  gmailStatus() {
    return this.request<Record<string, unknown>>("GET", "/admin/gmail/oauth/status");
  }

  gmailHealth() {
    return this.request<Record<string, unknown>>("GET", "/admin/gmail/health");
  }
}
