const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// Get credentials from environment variables
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY } = process.env;

// --- Helper Functions ---

// Fetches product data from Shopify for the AI prompt
async function fetchProductsForCapsules() {
  const query = `
    {
      products(first: 50) {
        edges {
          node {
            id handle title vendor tags description
            images(first: 1) { edges { node { url } } }
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
            }
          }
        }
      }
    }
  `;

  const response = await axios({
    method: "POST",
    url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
    },
    data: { query }
  });

  return response.data.data.products.edges.map(({ node }) => ({
    id: node.id,
    handle: node.handle,
    title: node.title,
    vendor: node.vendor,
    tags: node.tags,
    summary: node.description ? node.description.slice(0, 200) : "",
    imageUrl: node.images.edges[0]?.node?.url || null,
    price: node.priceRangeV2.minVariantPrice.amount,
    currency: node.priceRangeV2.minVariantPrice.currencyCode,
  }));
}

// Calls the Gemini API to get product matches
async function geminiSearch(userQuery, products) {
  const prompt = `
You are an e-commerce search assistant for a Shopify store.
User query: "${userQuery}"

Available products (capsules):
${products.map(
  p => `- ${p.title} (${p.price} ${p.currency}) | ${p.summary} | Tags: ${p.tags.join(", ")}`
).join("\n")}

Rules:
- Return ONLY titles of products that are strong matches.
- No guessing. If nothing matches, return [].
- Max 3 items.
- Output must be strictly valid JSON only. No explanations.
Output JSON format: { "matches": ["Product A","Product B"] }
`;

  const resp = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    },
    { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY } }
  );

  const raw = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try {
    return JSON.parse(raw);
  } catch (e) {
    const match = raw.match(/\{[\s\S]*\}/); // Attempt to clean up non-JSON text from response
    return match ? JSON.parse(match[0]) : { matches: [] };
  }
}

// --- Rate Limiter ---
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many requests",
      details: "You can only make 5 AI search requests per minute. Please wait and try again."
    });
  }
});

// --- API Route ---
// The route is now POST /, because the base path '/ai-search' is defined in server.js
router.post("/", searchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const products = await fetchProductsForCapsules();
    const result = await geminiSearch(query, products);

    // Map the titles from the AI response back to the full product objects
    const matched = products.filter(p => result.matches.includes(p.title));

    res.json({ matches: matched });
  } catch (err) {
    console.error("Gemini search failed:", err.message);
    res.status(500).json({ error: "Something went wrong!", details: err.message });
  }
});

module.exports = router;