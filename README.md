# @striderlabs/mcp-walgreens

MCP server connector for Walgreens — search products, manage prescriptions, cart, and checkout via browser automation.

## Installation

```bash
npx @striderlabs/mcp-walgreens
```

Or install globally:

```bash
npm install -g @striderlabs/mcp-walgreens
```

## MCP Configuration

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "walgreens": {
      "command": "npx",
      "args": ["@striderlabs/mcp-walgreens"]
    }
  }
}
```

## Tools

### `status`
Check Walgreens authentication status, session info, and preferred store.

**Parameters:** none

---

### `login`
Authenticate with Walgreens account using email and password via browser automation.

**Parameters:**
- `email` (string, required) — Walgreens account email
- `password` (string, required) — Walgreens account password
- `headless` (boolean, optional) — Run browser headless (default: `true`). Set `false` to see browser window (useful if CAPTCHA appears).

---

### `logout`
Clear Walgreens session and stored cookies.

**Parameters:** none

---

### `search`
Search Walgreens products and medications by query with optional filters.

**Parameters:**
- `query` (string, required) — Search term (e.g., `"ibuprofen"`, `"vitamin c"`)
- `category` (string, optional) — Category filter (e.g., `"vitamins"`, `"cold-flu"`, `"beauty"`)
- `min_price` (number, optional) — Minimum price filter
- `max_price` (number, optional) — Maximum price filter
- `limit` (number, optional) — Max results to return (default: 10, max: 24)

---

### `get_product`
Get detailed Walgreens product information by URL or product ID.

**Parameters:**
- `url` (string, optional) — Full Walgreens product URL
- `product_id` (string, optional) — Walgreens product ID (alternative to URL)

Returns: title, brand, price, product ID, rating, description, availability, images.

---

### `check_prescription_status`
Check the status of prescriptions in your Walgreens pharmacy account.

**Parameters:**
- `rx_number` (string, optional) — Prescription (Rx) number to check. Omit to list all prescriptions.

Returns: drug name, Rx number, status, refills remaining, days supply, last filled date.

---

### `refill_prescription`
Request a prescription refill at Walgreens pharmacy.

**Parameters:**
- `rx_number` (string, required) — Prescription (Rx) number to refill

---

### `add_to_cart`
Add a Walgreens product to the cart.

**Parameters:**
- `url` (string, optional) — Walgreens product URL
- `product_id` (string, optional) — Walgreens product ID (alternative to URL)
- `quantity` (number, optional) — Quantity to add (default: 1)

---

### `view_cart`
View current Walgreens cart contents and totals.

**Parameters:** none

Returns: list of items with name, price, quantity, subtotal, tax, and total.

---

### `remove_from_cart`
Remove a specific item from the Walgreens cart.

**Parameters:**
- `item_index` (number, optional) — 1-based index from `view_cart` results
- `product_name` (string, optional) — Partial product name to match (alternative to index)

---

### `set_store`
Set preferred Walgreens store location by ZIP code or store ID.

**Parameters:**
- `zip_code` (string, optional) — ZIP code to find nearby Walgreens stores
- `store_id` (string, optional) — Specific Walgreens store ID (alternative to ZIP)

Persists the store selection across sessions.

---

### `check_store_availability`
Check if a product is available at a Walgreens store location.

**Parameters:**
- `url` (string, optional) — Walgreens product URL
- `product_id` (string, optional) — Walgreens product ID (alternative to URL)
- `zip_code` (string, optional) — ZIP code to check. Uses preferred store if not provided.

Returns: in-store pickup availability, online shipping availability, store name.

---

### `checkout`
Proceed to checkout and return full order summary.

**Parameters:** none

> **Note:** This tool returns a checkout summary only — it does **not** auto-confirm or place the order. You must complete the purchase manually at the provided URL.

---

## Session Storage

Credentials are **never** stored. Only session cookies and metadata are persisted:

- `~/.striderlabs/walgreens/cookies.json` — Playwright session cookies
- `~/.striderlabs/walgreens/auth.json` — Account email, name, login timestamp
- `~/.striderlabs/walgreens/store.json` — Preferred store info

## Technical Details

- **Browser automation:** Playwright (Chromium)
- **Bot detection evasion:** Custom stealth patches (removes `navigator.webdriver`, spoofs plugins/languages)
- **Session persistence:** Cookies saved after each tool call, restored on next use
- **Transport:** stdio (MCP standard)

## Security Notes

- Passwords are never written to disk
- If CAPTCHA appears during login, set `headless: false` to complete it manually
- The `checkout` tool never auto-places orders — it's read-only for safety

## License

MIT — [Strider Labs](https://striderlabs.ai)
