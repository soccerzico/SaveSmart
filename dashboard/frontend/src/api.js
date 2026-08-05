// Minimal fetch helper. All calls hit relative /api paths, which Vite proxies
// to the Flask backend on :5100 in dev.

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  getConfig: () => request("GET", "/config"),
  createLinkToken: () => request("POST", "/create_link_token"),
  exchangePublicToken: (public_token, institution_name) =>
    request("POST", "/exchange_public_token", { public_token, institution_name }),
  getAccounts: () => request("GET", "/accounts"),
  removeItem: (item_id) => request("POST", "/items/remove", { item_id }),
};
