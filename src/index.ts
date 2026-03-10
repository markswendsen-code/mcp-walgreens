#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Page } from "playwright";
import { withPage, navigateToWalgreens, saveSessionCookies } from "./browser.js";
import {
  isLoggedIn,
  loadAuth,
  saveAuth,
  clearCookies,
  saveStore,
  loadStore,
} from "./session.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "walgreens", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "status",
      description: "Check Walgreens authentication status, session info, and preferred store",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "login",
      description:
        "Authenticate with Walgreens account using email and password via browser automation",
      inputSchema: {
        type: "object",
        properties: {
          email: { type: "string", description: "Walgreens account email" },
          password: { type: "string", description: "Walgreens account password" },
          headless: {
            type: "boolean",
            description:
              "Run browser in headless mode (default: true). Set false to see browser window.",
          },
        },
        required: ["email", "password"],
      },
    },
    {
      name: "logout",
      description: "Clear Walgreens session and stored cookies",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "search",
      description: "Search Walgreens products and medications by query with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term (e.g., 'ibuprofen', 'vitamin c')" },
          category: {
            type: "string",
            description: "Category filter (e.g., 'vitamins', 'cold-flu', 'beauty')",
          },
          min_price: { type: "number", description: "Minimum price filter" },
          max_price: { type: "number", description: "Maximum price filter" },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 10, max: 24)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_product",
      description: "Get detailed Walgreens product information by URL or product ID",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Full Walgreens product URL",
          },
          product_id: {
            type: "string",
            description: "Walgreens product ID (alternative to URL)",
          },
        },
      },
    },
    {
      name: "check_prescription_status",
      description: "Check the status of prescriptions in your Walgreens pharmacy account",
      inputSchema: {
        type: "object",
        properties: {
          rx_number: {
            type: "string",
            description: "Prescription (Rx) number to check (optional — omit to list all)",
          },
        },
      },
    },
    {
      name: "refill_prescription",
      description: "Request a prescription refill at Walgreens pharmacy",
      inputSchema: {
        type: "object",
        properties: {
          rx_number: {
            type: "string",
            description: "Prescription (Rx) number to refill",
          },
        },
        required: ["rx_number"],
      },
    },
    {
      name: "add_to_cart",
      description: "Add a Walgreens product to the cart",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Walgreens product URL" },
          product_id: { type: "string", description: "Walgreens product ID" },
          quantity: { type: "number", description: "Quantity to add (default: 1)" },
        },
      },
    },
    {
      name: "view_cart",
      description: "View current Walgreens cart contents and totals",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "remove_from_cart",
      description: "Remove a specific item from the Walgreens cart",
      inputSchema: {
        type: "object",
        properties: {
          item_index: {
            type: "number",
            description: "1-based index of the item to remove (from view_cart results)",
          },
          product_name: {
            type: "string",
            description: "Partial name of the product to remove (alternative to index)",
          },
        },
      },
    },
    {
      name: "set_store",
      description: "Set preferred Walgreens store location by ZIP code or store ID",
      inputSchema: {
        type: "object",
        properties: {
          zip_code: { type: "string", description: "ZIP code to find nearby Walgreens stores" },
          store_id: { type: "string", description: "Specific Walgreens store ID (alternative to ZIP)" },
        },
      },
    },
    {
      name: "check_store_availability",
      description: "Check if a product is available at a Walgreens store location",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Walgreens product URL" },
          product_id: { type: "string", description: "Walgreens product ID (alternative to URL)" },
          zip_code: {
            type: "string",
            description: "ZIP code to check nearby stores (uses preferred store if not provided)",
          },
        },
      },
    },
    {
      name: "checkout",
      description:
        "Proceed to checkout and return order summary. Does NOT auto-confirm — returns summary for review.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
}));

// ─── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "status":
        return await handleStatus();
      case "login":
        return await handleLogin(
          a.email as string,
          a.password as string,
          a.headless !== false
        );
      case "logout":
        return await handleLogout();
      case "search":
        return await handleSearch(
          a.query as string,
          a.category as string | undefined,
          a.min_price as number | undefined,
          a.max_price as number | undefined,
          Math.min((a.limit as number | undefined) ?? 10, 24)
        );
      case "get_product":
        return await handleGetProduct(
          a.url as string | undefined,
          a.product_id as string | undefined
        );
      case "check_prescription_status":
        return await handleCheckPrescriptionStatus(
          a.rx_number as string | undefined
        );
      case "refill_prescription":
        return await handleRefillPrescription(a.rx_number as string);
      case "add_to_cart":
        return await handleAddToCart(
          a.url as string | undefined,
          a.product_id as string | undefined,
          (a.quantity as number | undefined) ?? 1
        );
      case "view_cart":
        return await handleViewCart();
      case "remove_from_cart":
        return await handleRemoveFromCart(
          a.item_index as number | undefined,
          a.product_name as string | undefined
        );
      case "set_store":
        return await handleSetStore(
          a.zip_code as string | undefined,
          a.store_id as string | undefined
        );
      case "check_store_availability":
        return await handleCheckStoreAvailability(
          a.url as string | undefined,
          a.product_id as string | undefined,
          a.zip_code as string | undefined
        );
      case "checkout":
        return await handleCheckout();
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Tool '${name}' failed: ${msg}`);
  }
});

// ─── Handler implementations ───────────────────────────────────────────────────

async function handleStatus() {
  const loggedIn = isLoggedIn();
  const auth = loadAuth();
  const store = loadStore();

  if (!loggedIn) {
    return ok(
      "Not logged in. Use the `login` tool to authenticate with your Walgreens account.\n" +
      (store ? `Preferred store: ${store.storeName} (${store.address})` : "No preferred store set.")
    );
  }

  const lines = [
    `Logged in as: ${auth?.email ?? "unknown"}`,
    `Name: ${auth?.name ?? "unknown"}`,
    `Session established: ${auth?.loggedInAt ?? "unknown"}`,
    "",
    store
      ? `Preferred store: ${store.storeName} (${store.address})`
      : "No preferred store set. Use `set_store` to choose one.",
  ];

  return ok(lines.join("\n"));
}

async function handleLogin(email: string, password: string, headless: boolean) {
  if (!email || !password) {
    return err("email and password are required");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.walgreens.com/login.jsp", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Check if already logged in
    const accountEl = await page.$(
      '[data-testid="account-name"], .account-name, [aria-label*="account"], [class*="myAccount"], [class*="my-account"]'
    );
    if (accountEl) {
      const text = await accountEl.textContent();
      if (text && !text.toLowerCase().includes("sign in") && !text.toLowerCase().includes("log in")) {
        const name = text.trim();
        saveAuth({ email, loggedInAt: new Date().toISOString(), name });
        return ok(`Already logged in as ${name}`);
      }
    }

    // Fill username/email
    const emailInput = await page.waitForSelector(
      'input[id="user_name"], input[name="user_name"], input[id="userName"], input[name="userName"], input[type="email"], input[id="email"]',
      { timeout: 15000 }
    );
    await emailInput.click();
    await emailInput.fill(email);

    await page.waitForTimeout(500);

    // Fill password
    const passwordInput = await page.waitForSelector(
      'input[id="user_password"], input[name="user_password"], input[type="password"], input[id="password"]',
      { timeout: 10000 }
    );
    await passwordInput.click();
    await passwordInput.fill(password);

    // Submit
    const submitBtn = await page.waitForSelector(
      'button[type="submit"], input[type="submit"], button[id*="login"], button[class*="login"], #submit_btn',
      { timeout: 5000 }
    );
    await submitBtn.click();

    // Wait for navigation
    await page.waitForTimeout(3500);

    // Check for error messages
    const errorEl = await page.$(
      '[class*="error"], [id*="error"], .errorMsg, .error-message, [data-testid*="error"]'
    );
    if (errorEl) {
      const errorText = await errorEl.textContent();
      if (errorText && errorText.trim().length > 0 && errorText.trim().length < 300) {
        return err(`Login failed: ${errorText.trim()}`);
      }
    }

    // Detect success by URL
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("login.jsp") ||
      currentUrl.includes("/signin")
    ) {
      return err(
        "Login may have failed — still on login page. Check credentials or try with headless=false."
      );
    }

    // Try to get account name
    let name: string | undefined;
    try {
      const nameEl = await page.$(
        '[class*="account-name"], [data-testid="account-name"], .welcome-message, [class*="greeting"], [class*="myAccount"]'
      );
      if (nameEl) name = (await nameEl.textContent())?.trim();
    } catch {
      // ignore
    }

    await saveSessionCookies();
    saveAuth({ email, loggedInAt: new Date().toISOString(), name });

    return ok(`Successfully logged in as ${name ?? email}`);
  }, headless);
}

async function handleLogout() {
  clearCookies();
  return ok("Logged out. Walgreens session cookies cleared.");
}

async function handleSearch(
  query: string,
  category?: string,
  minPrice?: number,
  maxPrice?: number,
  limit = 10
) {
  return withPage(async (page: Page) => {
    const params = new URLSearchParams({ Ntt: query });
    if (category) params.set("N", category);

    const searchUrl = `https://www.walgreens.com/search/results.jsp?${params.toString()}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    // Wait for product results
    try {
      await page.waitForSelector(
        '[class*="product-list"], [class*="productList"], [class*="search-results"], .product-card, [class*="productCard"], [data-testid*="product"]',
        { timeout: 15000 }
      );
    } catch {
      return err(`No products found for "${query}" or page failed to load`);
    }

    const products = await page.evaluate(
      ({ minPrice, maxPrice, limit }: { minPrice?: number; maxPrice?: number; limit: number }) => {
        const selectors = [
          '[class*="productCard"]',
          '[class*="product-card"]',
          '.productCard',
          '[data-testid="product-card"]',
          '[class*="product__item"]',
          '[class*="product-item"]',
          'li[class*="product"]',
        ];

        let cards: Element[] = [];
        for (const sel of selectors) {
          cards = Array.from(document.querySelectorAll(sel));
          if (cards.length > 0) break;
        }

        const results: Array<{
          title: string;
          price: string;
          url: string;
          product_id: string;
          image: string;
          brand: string;
          rating: string;
        }> = [];

        for (const card of cards) {
          if (results.length >= limit) break;

          const titleEl =
            card.querySelector('[class*="product-name"], [class*="productName"], [class*="product__name"], h3, h4, p[class*="title"]') as HTMLElement | null;
          const title = titleEl?.textContent?.trim() ?? "";

          const priceEl =
            card.querySelector('[class*="price"], [class*="Price"], [data-testid*="price"]') as HTMLElement | null;
          const priceText = priceEl?.textContent?.trim() ?? "";
          const priceNum = parseFloat(priceText.replace(/[^0-9.]/g, ""));

          if (minPrice && !isNaN(priceNum) && priceNum < minPrice) continue;
          if (maxPrice && !isNaN(priceNum) && priceNum > maxPrice) continue;

          const linkEl = card.querySelector('a[href*="/store/product"], a[href*="/store/c/"]') as HTMLAnchorElement | null;
          const href = linkEl?.href ?? (card.querySelector("a") as HTMLAnchorElement | null)?.href ?? "";

          // Extract product ID from Walgreens URL pattern: /store/c/NAME/ID=prod123-product
          const idMatch = href.match(/ID=prod([^-]+)/i) ?? href.match(/\/(\d{6,})\b/);
          const product_id = idMatch ? idMatch[1] : "";

          const imgEl = card.querySelector("img") as HTMLImageElement | null;
          const image = imgEl?.src ?? "";

          const brandEl = card.querySelector('[class*="brand"], [class*="Brand"], [class*="manufacturer"]') as HTMLElement | null;
          const brand = brandEl?.textContent?.trim() ?? "";

          const ratingEl = card.querySelector('[class*="rating"], [aria-label*="out of"], [class*="stars"]') as HTMLElement | null;
          const rating = ratingEl?.getAttribute("aria-label") ?? ratingEl?.textContent?.trim() ?? "";

          if (title) {
            results.push({ title, price: priceText, url: href, product_id, image, brand, rating });
          }
        }

        return results;
      },
      { minPrice, maxPrice, limit }
    );

    if (products.length === 0) {
      return ok(`No products found for "${query}"`);
    }

    const lines = [`Found ${products.length} products for "${query}":\n`];
    products.forEach((p, i) => {
      lines.push(
        `${i + 1}. ${p.title}` +
        (p.brand ? ` — ${p.brand}` : "") + "\n" +
        `   Price: ${p.price || "N/A"}\n` +
        (p.product_id ? `   Product ID: ${p.product_id}\n` : "") +
        (p.rating ? `   Rating: ${p.rating}\n` : "") +
        `   URL: ${p.url}\n`
      );
    });

    return ok(lines.join("\n"));
  });
}

async function handleGetProduct(url?: string, productId?: string) {
  if (!url && !productId) {
    return err("Provide either url or product_id");
  }

  return withPage(async (page: Page) => {
    const targetUrl = url ?? `https://www.walgreens.com/store/c/product/ID=prod${productId}-product`;

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    try {
      await page.waitForSelector(
        'h1, [class*="product-title"], [class*="productTitle"], [class*="product__name"], [class*="pdp"]',
        { timeout: 15000 }
      );
    } catch {
      return err("Product page failed to load");
    }

    const product = await page.evaluate(() => {
      const title =
        document.querySelector('[class*="product-title"], [class*="productTitle"], [class*="product__name"], h1')
          ?.textContent?.trim() ?? "";

      const priceEl =
        document.querySelector('[class*="price"], [class*="Price"], [data-testid*="price"], .product__price') as HTMLElement | null;
      const price = priceEl?.textContent?.trim() ?? "";

      const brand =
        document.querySelector('[class*="brand"], [class*="Brand"], [class*="manufacturer"]')?.textContent?.trim() ?? "";

      const description =
        document.querySelector(
          '[class*="description"], [id*="description"], [data-testid="description"], [class*="product-detail"], [class*="productDetail"]'
        )?.textContent?.trim()?.slice(0, 600) ?? "";

      const ratingEl = document.querySelector('[class*="rating"], [class*="Rating"], [class*="stars"]') as HTMLElement | null;
      const rating = ratingEl?.getAttribute("aria-label") ?? ratingEl?.textContent?.trim() ?? "";

      const reviewsEl = document.querySelector('[class*="review-count"], [class*="reviewCount"], [class*="reviews-count"]') as HTMLElement | null;
      const reviews = reviewsEl?.textContent?.trim() ?? "";

      const availabilityEl = document.querySelector(
        '[class*="availability"], [class*="Availability"], [class*="stock"], [data-testid="availability"], [class*="fulfillment"]'
      ) as HTMLElement | null;
      const availability = availabilityEl?.textContent?.trim()?.slice(0, 200) ?? "";

      const images = Array.from(
        document.querySelectorAll('[class*="product-image"] img, [class*="productImage"] img, [class*="gallery"] img, [class*="carousel"] img')
      )
        .map((img) => (img as HTMLImageElement).src)
        .filter((src) => src && !src.includes("data:") && src.startsWith("http"))
        .slice(0, 3);

      // Extract product ID from Walgreens URL
      const urlMatch = window.location.href.match(/ID=prod([^-]+)/i) ?? window.location.href.match(/\/(\d{6,})\b/);
      const product_id = urlMatch ? urlMatch[1] : "";

      return { title, price, brand, description, rating, reviews, availability, images, product_id };
    });

    const lines = [
      `**${product.title}**`,
      `Brand: ${product.brand || "N/A"}`,
      `Price: ${product.price || "N/A"}`,
      `Product ID: ${product.product_id || "N/A"}`,
      `Rating: ${product.rating || "N/A"}${product.reviews ? ` (${product.reviews})` : ""}`,
      "",
      `**Description:**`,
      product.description || "N/A",
      "",
      `**Availability:**`,
      product.availability || "N/A",
      "",
      `URL: ${page.url()}`,
    ];

    if (product.images.length > 0) {
      lines.push(`\nImages:\n${product.images.join("\n")}`);
    }

    return ok(lines.join("\n"));
  });
}

async function handleCheckPrescriptionStatus(rxNumber?: string) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.walgreens.com/pharmacy/prescription-management.jsp", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    // Redirect to login if session expired
    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/signin")) {
      return err("Session expired. Please use the `login` tool to re-authenticate.");
    }

    // If specific Rx number provided, try to search for it
    if (rxNumber) {
      try {
        const searchInput = await page.$(
          'input[placeholder*="prescription" i], input[name*="rx" i], input[id*="rx" i], input[placeholder*="rx number" i]'
        );
        if (searchInput) {
          await searchInput.fill(rxNumber);
          const searchBtn = await page.$('button[type="submit"], button[class*="search"]');
          if (searchBtn) {
            await searchBtn.click();
            await page.waitForTimeout(2000);
          }
        }
      } catch {
        // Continue without filtering
      }
    }

    const prescriptions = await page.evaluate((filterRx?: string) => {
      const rxSelectors = [
        '[class*="prescription-card"]',
        '[class*="prescriptionCard"]',
        '[class*="rx-card"]',
        '[class*="prescription-item"]',
        '[class*="rx-item"]',
        '[data-testid*="prescription"]',
        '[class*="refill-item"]',
      ];

      let rxEls: Element[] = [];
      for (const sel of rxSelectors) {
        rxEls = Array.from(document.querySelectorAll(sel));
        if (rxEls.length > 0) break;
      }

      // Fallback: look for table rows with Rx numbers
      if (rxEls.length === 0) {
        rxEls = Array.from(document.querySelectorAll('tr[class*="rx"], .rx-row, [role="row"]')).filter(
          (el) => el.textContent?.match(/\d{7,}/)
        );
      }

      return rxEls.map((el) => {
        const rxNum =
          el.querySelector('[class*="rx-number"], [class*="rxNumber"], [class*="prescription-number"]')?.textContent?.trim() ??
          el.textContent?.match(/Rx[:\s#]*(\d+)/i)?.[1] ?? "";

        const drug =
          el.querySelector('[class*="drug-name"], [class*="drugName"], [class*="medication"], [class*="medName"], h3, h4')?.textContent?.trim() ??
          "";

        const status =
          el.querySelector('[class*="status"], [class*="Status"]')?.textContent?.trim() ?? "";

        const refillsLeft =
          el.querySelector('[class*="refills"], [class*="Refills"], [class*="refills-remaining"]')?.textContent?.trim() ?? "";

        const daysSupply =
          el.querySelector('[class*="days-supply"], [class*="daysSupply"]')?.textContent?.trim() ?? "";

        const lastFilled =
          el.querySelector('[class*="last-fill"], [class*="lastFill"], [class*="fill-date"], [class*="fillDate"]')?.textContent?.trim() ??
          "";

        return { rxNum, drug, status, refillsLeft, daysSupply, lastFilled };
      }).filter((rx) => !filterRx || rx.rxNum.includes(filterRx) || filterRx.includes(rx.rxNum));
    }, rxNumber);

    if (prescriptions.length === 0) {
      const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      return ok(
        `No prescriptions found${rxNumber ? ` for Rx #${rxNumber}` : ""}.\n\n` +
        `Page content preview:\n${pageText}`
      );
    }

    const lines = [
      `**Prescription Status${rxNumber ? ` — Rx #${rxNumber}` : ""}**\n`,
      `Found ${prescriptions.length} prescription${prescriptions.length !== 1 ? "s" : ""}:\n`,
    ];

    prescriptions.forEach((rx, i) => {
      lines.push(
        `${i + 1}. ${rx.drug || "Unknown medication"}\n` +
        (rx.rxNum ? `   Rx #: ${rx.rxNum}\n` : "") +
        `   Status: ${rx.status || "N/A"}\n` +
        (rx.refillsLeft ? `   Refills remaining: ${rx.refillsLeft}\n` : "") +
        (rx.daysSupply ? `   Days supply: ${rx.daysSupply}\n` : "") +
        (rx.lastFilled ? `   Last filled: ${rx.lastFilled}\n` : "")
      );
    });

    return ok(lines.join("\n"));
  });
}

async function handleRefillPrescription(rxNumber: string) {
  if (!rxNumber) {
    return err("rx_number is required");
  }
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.walgreens.com/pharmacy/prescription-management.jsp", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2500);

    const currentUrl = page.url();
    if (currentUrl.includes("/login") || currentUrl.includes("/signin")) {
      return err("Session expired. Please use the `login` tool to re-authenticate.");
    }

    let refillClicked = false;

    // Find the refill button near this Rx number
    const rxEls = await page.$$('[class*="prescription"], [class*="rx-card"], [class*="prescriptionCard"], [data-testid*="prescription"]');

    for (const rxEl of rxEls) {
      const text = await rxEl.textContent();
      if (text?.includes(rxNumber)) {
        const refillBtn = await rxEl.$(
          'button[class*="refill" i], button[aria-label*="refill" i], a[class*="refill" i], [data-testid*="refill"]'
        );
        if (refillBtn) {
          await refillBtn.click();
          await page.waitForTimeout(2000);
          refillClicked = true;
          break;
        }
      }
    }

    // Fallback: try direct refill URL
    if (!refillClicked) {
      await page.goto(`https://www.walgreens.com/pharmacy/refill/rxrefill.jsp?rxNum=${rxNumber}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      const refillBtn = await page.$(
        'button[class*="refill" i], button[type="submit"], [data-testid="refill-submit"]'
      );
      if (refillBtn) {
        await refillBtn.click();
        await page.waitForTimeout(2000);
        refillClicked = true;
      }
    }

    if (!refillClicked) {
      return err(
        `Could not find refill option for Rx #${rxNumber}. ` +
        "Please verify the prescription number using `check_prescription_status`."
      );
    }

    // Confirm modal if present
    try {
      const confirmBtn = await page.waitForSelector(
        'button[class*="confirm" i], button[data-testid*="confirm"], button[aria-label*="confirm" i]',
        { timeout: 3000 }
      );
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForTimeout(2000);
      }
    } catch {
      // No confirmation modal
    }

    // Check for success message
    const successEl = await page.$(
      '[class*="success"], [class*="confirmation"], [data-testid*="success"], .alert-success'
    );
    const successText = successEl ? await successEl.textContent() : null;

    if (successText) {
      return ok(`Refill requested for Rx #${rxNumber}.\n\n${successText.trim()}`);
    }

    return ok(
      `Refill request submitted for Rx #${rxNumber}.\n` +
      `Please check 'check_prescription_status' to confirm the refill is being processed.`
    );
  });
}

async function handleAddToCart(url?: string, productId?: string, quantity = 1) {
  if (!url && !productId) {
    return err("Provide either url or product_id");
  }

  return withPage(async (page: Page) => {
    const targetUrl = url ?? `https://www.walgreens.com/store/c/product/ID=prod${productId}-product`;

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Adjust quantity if > 1
    if (quantity > 1) {
      try {
        const qtyInput = await page.$(
          'input[aria-label*="quantity" i], input[name*="quantity"], select[name*="quantity"], [data-testid*="quantity"] input'
        );
        if (qtyInput) {
          const tagName = await qtyInput.evaluate((el) => el.tagName.toLowerCase());
          if (tagName === "select") {
            await qtyInput.selectOption(String(quantity));
          } else {
            await qtyInput.fill(String(quantity));
          }
        }
      } catch {
        // Ignore quantity adjustment errors
      }
    }

    // Find and click Add to Cart button
    const addBtn = await page.waitForSelector(
      'button[class*="add-to-cart" i], button[aria-label*="add to cart" i], [data-testid*="add-to-cart"], button[id*="addToCart"], button[class*="addToCart"]',
      { timeout: 10000 }
    );

    const btnText = await addBtn.textContent();
    if (
      btnText?.toLowerCase().includes("out of stock") ||
      btnText?.toLowerCase().includes("unavailable") ||
      btnText?.toLowerCase().includes("not available")
    ) {
      return err("Item is out of stock or unavailable");
    }

    await addBtn.click();
    await page.waitForTimeout(3000);

    // Check for cart confirmation
    const confirmation = await page.$(
      '[class*="cart-count"], [aria-label*="items in cart" i], [data-testid*="cart-count"], .cart-badge, [class*="cartCount"]'
    );
    const count = confirmation ? await confirmation.textContent() : null;

    // Get product title for confirmation
    const productTitle = await page.evaluate(() =>
      document.querySelector('h1, [class*="product-title"], [class*="productTitle"]')?.textContent?.trim() ?? ""
    );

    return ok(
      `Successfully added to cart.\n` +
      (productTitle ? `Product: ${productTitle}\n` : "") +
      `Quantity: ${quantity}\n` +
      (count ? `Cart count: ${count}\n` : "") +
      `URL: ${targetUrl}`
    );
  });
}

async function handleViewCart() {
  return withPage(async (page: Page) => {
    await page.goto("https://www.walgreens.com/store/cart", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const cart = await page.evaluate(() => {
      const emptyMsg = document.querySelector(
        '[class*="empty-cart"], [class*="emptyCart"], [data-testid*="empty-cart"], [class*="cart-empty"]'
      );
      if (emptyMsg && emptyMsg.textContent?.toLowerCase().includes("empty")) {
        return { empty: true, items: [], subtotal: "", tax: "", total: "" };
      }

      const itemSelectors = [
        '[class*="cart-item"]',
        '[class*="cartItem"]',
        '[data-testid*="cart-item"]',
        '.cart-product',
        '[class*="lineItem"]',
        '[class*="line-item"]',
      ];

      let itemEls: Element[] = [];
      for (const sel of itemSelectors) {
        itemEls = Array.from(document.querySelectorAll(sel));
        if (itemEls.length > 0) break;
      }

      const items = itemEls.map((item) => {
        const title =
          item.querySelector('[class*="product-name"], [class*="productName"], [class*="item-name"], [class*="itemName"], h3, h4')
            ?.textContent?.trim() ?? "";
        const price =
          item.querySelector('[class*="price"], [class*="Price"]')?.textContent?.trim() ?? "";
        const qty = (() => {
          const qtyInput = item.querySelector('input[aria-label*="quantity" i], input[name*="quantity"]') as HTMLInputElement | null;
          if (qtyInput) return qtyInput.value;
          return item.querySelector('[class*="quantity"], [class*="Quantity"], [class*="qty"]')?.textContent?.trim() ?? "1";
        })();
        const brand =
          item.querySelector('[class*="brand"]')?.textContent?.trim() ?? "";
        return { title, price, qty, brand };
      });

      const subtotal =
        document.querySelector('[class*="subtotal"], [class*="Subtotal"], [data-testid*="subtotal"]')?.textContent?.trim() ?? "";
      const tax =
        document.querySelector('[class*="tax"], [class*="Tax"], [data-testid*="tax"]')?.textContent?.trim() ?? "";
      const total =
        document.querySelector('[class*="total"], [class*="Total"], [class*="order-total"], [class*="orderTotal"]')
          ?.textContent?.trim() ?? "";

      return { empty: items.length === 0, items, subtotal, tax, total };
    });

    if (cart.empty) {
      return ok("Cart is empty.");
    }

    const lines = [`**Cart (${cart.items.length} item${cart.items.length !== 1 ? "s" : ""})**\n`];
    cart.items.forEach((item, i) => {
      lines.push(
        `${i + 1}. ${item.title}` + (item.brand ? ` — ${item.brand}` : "") + "\n" +
        `   Price: ${item.price || "N/A"}  Qty: ${item.qty}`
      );
    });

    if (cart.subtotal) lines.push(`\nSubtotal: ${cart.subtotal}`);
    if (cart.tax) lines.push(`Tax: ${cart.tax}`);
    if (cart.total) lines.push(`Total: ${cart.total}`);

    return ok(lines.join("\n"));
  });
}

async function handleRemoveFromCart(itemIndex?: number, productName?: string) {
  if (!itemIndex && !productName) {
    return err("Provide either item_index or product_name");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.walgreens.com/store/cart", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const itemSelectors = [
      '[class*="cart-item"]',
      '[class*="cartItem"]',
      '[data-testid*="cart-item"]',
      '.cart-product',
      '[class*="lineItem"]',
      '[class*="line-item"]',
    ];

    let foundItems: import("playwright").ElementHandle<Element>[] = [];

    for (const sel of itemSelectors) {
      foundItems = await page.$$(sel);
      if (foundItems.length > 0) break;
    }

    if (foundItems.length === 0) {
      return ok("Cart is empty.");
    }

    let targetItem: import("playwright").ElementHandle<Element> | null = null;
    let targetTitle = "";

    if (itemIndex) {
      const idx = itemIndex - 1;
      if (idx < 0 || idx >= foundItems.length) {
        return err(`Item index ${itemIndex} is out of range. Cart has ${foundItems.length} item(s).`);
      }
      targetItem = foundItems[idx];
      targetTitle = await targetItem.evaluate((el: Element) =>
        el.querySelector('[class*="product-name"], [class*="productName"], [class*="item-name"], h3, h4')?.textContent?.trim() ?? ""
      );
    } else if (productName) {
      for (const item of foundItems) {
        const text = await item.textContent();
        if (text?.toLowerCase().includes(productName.toLowerCase())) {
          targetItem = item;
          targetTitle = text.trim().slice(0, 60);
          break;
        }
      }
      if (!targetItem) {
        return err(`No cart item matching "${productName}" found.`);
      }
    }

    if (!targetItem) {
      return err("Could not identify the item to remove.");
    }

    const removeBtn = await targetItem.$(
      'button[aria-label*="remove" i], button[class*="remove"], [data-testid*="remove"], button[class*="delete"], [class*="removeItem"]'
    );

    if (!removeBtn) {
      return err("Could not find remove button for this item.");
    }

    await removeBtn.click();
    await page.waitForTimeout(1500);

    // Confirm removal dialog if present
    try {
      const confirmBtn = await page.waitForSelector(
        'button[class*="confirm" i], button[data-testid*="confirm"]',
        { timeout: 2000 }
      );
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No confirmation dialog
    }

    return ok(`Removed "${targetTitle || "item"}" from cart.`);
  });
}

async function handleSetStore(zipCode?: string, storeId?: string) {
  if (!zipCode && !storeId) {
    return err("Provide either zip_code or store_id");
  }

  return withPage(async (page: Page) => {
    const locatorUrl = storeId
      ? `https://www.walgreens.com/storelocator/find.jsp?requestType=locateAStore&storeId=${storeId}`
      : `https://www.walgreens.com/storelocator/find.jsp?requestType=locateAStore&zip=${zipCode}`;

    await page.goto(locatorUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    // If ZIP code search, look for results
    if (zipCode && !storeId) {
      try {
        await page.waitForSelector(
          '[class*="store-card"], [class*="storeCard"], [class*="store-result"], [class*="storeResult"], [data-testid*="store"]',
          { timeout: 15000 }
        );
      } catch {
        // Try entering zip in search box if present
        const searchInput = await page.$(
          'input[placeholder*="zip" i], input[placeholder*="city" i], input[id*="store-search"], input[name*="zip"]'
        );
        if (searchInput) {
          await searchInput.fill(zipCode);
          await searchInput.press("Enter");
          await page.waitForTimeout(2500);
        }
      }
    }

    const storeInfo = await page.evaluate((targetStoreId?: string) => {
      const storeSelectors = [
        '[class*="store-card"]',
        '[class*="storeCard"]',
        '[class*="store-result"]',
        '[class*="storeResult"]',
        '[data-testid*="store-item"]',
        '[class*="store-listing"]',
        '[class*="storeListing"]',
      ];

      let storeEls: Element[] = [];
      for (const sel of storeSelectors) {
        storeEls = Array.from(document.querySelectorAll(sel));
        if (storeEls.length > 0) break;
      }

      if (storeEls.length === 0) return null;

      // Find specific store or take first
      let target = storeEls[0];
      if (targetStoreId) {
        const found = storeEls.find((el) => el.textContent?.includes(targetStoreId));
        if (found) target = found;
      }

      const nameEl = target.querySelector(
        '[class*="store-name"], [class*="storeName"], h3, h4, [class*="heading"]'
      );
      const storeName = nameEl?.textContent?.trim() ?? "Walgreens";

      const addressEl = target.querySelector(
        '[class*="address"], [class*="Address"], address, [class*="store-address"]'
      );
      const address = addressEl?.textContent?.trim() ?? "";

      const idEl = target.querySelector('[data-store-id], [class*="store-id"]');
      const foundStoreId =
        idEl?.getAttribute("data-store-id") ??
        target.getAttribute("data-store-id") ??
        window.location.href.match(/storeId=(\d+)/)?.[1] ??
        window.location.pathname.match(/\d{4,}/)?.[0] ?? "";

      return { storeName, address, storeId: foundStoreId };
    }, storeId);

    if (!storeInfo) {
      return err(`No stores found${zipCode ? ` near ZIP code ${zipCode}` : ""}. Try a different location.`);
    }

    const store = {
      storeId: storeInfo.storeId || storeId || "",
      storeName: storeInfo.storeName,
      address: storeInfo.address,
      setAt: new Date().toISOString(),
    };

    saveStore(store);

    return ok(
      `Preferred store set:\n` +
      `Store: ${store.storeName}\n` +
      (store.address ? `Address: ${store.address}\n` : "") +
      (store.storeId ? `Store ID: ${store.storeId}\n` : "")
    );
  });
}

async function handleCheckStoreAvailability(url?: string, productId?: string, zipCode?: string) {
  if (!url && !productId) {
    return err("Provide either url or product_id");
  }

  const store = loadStore();

  return withPage(async (page: Page) => {
    const targetUrl = url ?? `https://www.walgreens.com/store/c/product/ID=prod${productId}-product`;

    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Try to update store location if ZIP provided
    if (zipCode) {
      try {
        const storeBtn = await page.$(
          '[class*="store-selector"], [aria-label*="store" i], [class*="change-store"], [class*="myStore"], [data-testid*="store-selector"]'
        );
        if (storeBtn) {
          await storeBtn.click();
          await page.waitForTimeout(1000);

          const zipInput = await page.waitForSelector(
            'input[placeholder*="zip" i], input[name*="zip"]',
            { timeout: 5000 }
          );
          await zipInput.fill(zipCode);
          await zipInput.press("Enter");
          await page.waitForTimeout(2500);
        }
      } catch {
        // Continue without location update
      }
    }

    const availability = await page.evaluate(() => {
      const pickupSection = document.querySelector(
        '[class*="pickup"], [class*="in-store"], [data-testid*="pickup"], [class*="store-availability"], [class*="storeAvailability"], [class*="bopis"]'
      );

      if (!pickupSection) {
        const allAvailability = document.querySelector(
          '[class*="availability"], [class*="Availability"], [class*="fulfillment"], [class*="Fulfillment"]'
        );
        return {
          inStore: false,
          online: false,
          details: allAvailability?.textContent?.trim()?.slice(0, 500) ?? "Availability information not found",
          storeName: "",
        };
      }

      const text = pickupSection.textContent?.toLowerCase() ?? "";
      const inStore =
        !text.includes("not available") &&
        !text.includes("out of stock") &&
        !text.includes("unavailable") &&
        text.length > 0;

      const onlineSection = document.querySelector(
        '[class*="ship"], [class*="delivery"], [data-testid*="shipping"], [class*="online-availability"]'
      );
      const onlineText = onlineSection?.textContent?.toLowerCase() ?? "";
      const online = onlineSection
        ? !onlineText.includes("not available") && !onlineText.includes("out of stock")
        : false;

      const storeNameEl = document.querySelector(
        '[class*="store-name"], [class*="storeName"], [class*="my-store"], [class*="myStore"]'
      );
      const storeName = storeNameEl?.textContent?.trim() ?? "";

      return {
        inStore,
        online,
        details: pickupSection.textContent?.trim()?.slice(0, 400) ?? "",
        storeName,
      };
    });

    const lines = [
      `**Store Availability**`,
      `In-store pickup: ${availability.inStore ? "Available" : "Not available"}`,
      `Online/shipping: ${availability.online ? "Available" : "Not available"}`,
    ];

    if (availability.storeName) {
      lines.push(`Store: ${availability.storeName}`);
    } else if (store) {
      lines.push(`Checked store: ${store.storeName} (${store.address})`);
    }

    if (availability.details) {
      lines.push(`\nDetails: ${availability.details}`);
    }

    lines.push(`\nProduct URL: ${page.url()}`);

    return ok(lines.join("\n"));
  });
}

async function handleCheckout() {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    // Navigate to cart first
    await page.goto("https://www.walgreens.com/store/cart", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    const cartSummary = await page.evaluate(() => {
      const itemSelectors = [
        '[class*="cart-item"]',
        '[class*="cartItem"]',
        '[data-testid*="cart-item"]',
        '.cart-product',
        '[class*="lineItem"]',
        '[class*="line-item"]',
      ];

      let itemEls: Element[] = [];
      for (const sel of itemSelectors) {
        itemEls = Array.from(document.querySelectorAll(sel));
        if (itemEls.length > 0) break;
      }

      const items = itemEls.map((item) => {
        const title =
          item.querySelector('[class*="product-name"], [class*="productName"], [class*="item-name"], h3, h4')
            ?.textContent?.trim() ?? "";
        const price =
          item.querySelector('[class*="price"]')?.textContent?.trim() ?? "";
        const qty = (() => {
          const qtyInput = item.querySelector('input[aria-label*="quantity" i]') as HTMLInputElement | null;
          if (qtyInput) return qtyInput.value;
          return item.querySelector('[class*="quantity"], [class*="qty"]')?.textContent?.trim() ?? "1";
        })();
        return `${title} × ${qty} — ${price}`;
      });

      const subtotal =
        document.querySelector('[class*="subtotal"], [data-testid*="subtotal"]')?.textContent?.trim() ?? "";
      const tax =
        document.querySelector('[class*="tax"], [data-testid*="tax"]')?.textContent?.trim() ?? "";
      const total =
        document.querySelector('[class*="order-total"], [class*="orderTotal"], [class*="total-price"]')
          ?.textContent?.trim() ?? "";

      return { items, subtotal, tax, total };
    });

    if (cartSummary.items.length === 0) {
      return err("Cart is empty. Add items before checking out.");
    }

    // Navigate to checkout page to get full summary
    const checkoutBtn = await page.$(
      'button[class*="checkout" i], a[class*="checkout" i], [data-testid*="checkout"], a[href*="/checkout"]'
    );

    let checkoutUrl = "https://www.walgreens.com/checkout/";
    if (checkoutBtn) {
      const href = await checkoutBtn.getAttribute("href");
      if (href) checkoutUrl = href.startsWith("http") ? href : `https://www.walgreens.com${href}`;
    }

    // Navigate to checkout to get complete summary
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    const checkoutSummary = await page.evaluate(() => {
      const subtotal =
        document.querySelector('[class*="subtotal"], [data-testid*="subtotal"]')?.textContent?.trim() ?? "";
      const tax =
        document.querySelector('[class*="tax"], [data-testid*="tax"]')?.textContent?.trim() ?? "";
      const shipping =
        document.querySelector('[class*="shipping"], [data-testid*="shipping-cost"]')?.textContent?.trim() ?? "";
      const total =
        document.querySelector('[class*="order-total"], [class*="orderTotal"], [class*="grand-total"], [data-testid*="total"]')
          ?.textContent?.trim() ?? "";
      const deliveryInfo =
        document.querySelector('[class*="delivery-address"], [class*="deliveryAddress"], [class*="shipping-address"]')
          ?.textContent?.trim()?.slice(0, 200) ?? "";

      return { subtotal, tax, shipping, total, deliveryInfo };
    });

    const summary = [
      `**Order Summary (${cartSummary.items.length} item${cartSummary.items.length !== 1 ? "s" : ""})**\n`,
      ...cartSummary.items.map((item, i) => `${i + 1}. ${item}`),
      "",
    ];

    const totals = checkoutSummary.subtotal || cartSummary.subtotal;
    if (totals) summary.push(`Subtotal: ${totals}`);
    if (checkoutSummary.shipping) summary.push(`Shipping: ${checkoutSummary.shipping}`);
    if (checkoutSummary.tax || cartSummary.tax) summary.push(`Tax: ${checkoutSummary.tax || cartSummary.tax}`);
    if (checkoutSummary.total || cartSummary.total) summary.push(`Total: ${checkoutSummary.total || cartSummary.total}`);
    if (checkoutSummary.deliveryInfo) summary.push(`\nDelivery to: ${checkoutSummary.deliveryInfo}`);

    summary.push(
      "\n⚠️  This is a checkout summary — the order has NOT been placed.",
      "To complete your purchase, visit: " + page.url(),
      "\nNote: This MCP tool returns summaries only and does not auto-confirm orders."
    );

    return ok(summary.filter(Boolean).join("\n"));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true };
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Walgreens MCP server running on stdio\n");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(1);
});
