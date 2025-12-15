// const express = require("express");
// const axios = require("axios");
// const rateLimit = require("express-rate-limit");
// const router = express.Router();

// // Get credentials from environment variables
// const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY } = process.env;

// // --- Helper Functions ---

// // Fetches product data from Shopify for the AI prompt
// // Updated function to fetch ALL products with pagination
// async function fetchProductsForCapsules() {
//   let allProducts = [];
//   let hasNextPage = true;
//   let cursor = null;

//   while (hasNextPage) {
//     const query = `
//       query getProducts($first: Int!, $after: String) {
//         products(first: $first, after: $after) {
//           edges {
//             node {
//               id
//               handle
//               title
//               vendor
//               tags
//               description
//               status
//               productType
//               variants(first: 10) {
//                 edges {
//                   node {
//                     id
//                     title
//                     price
//                     sku
//                     inventoryQuantity
//                     availableForSale
//                   }
//                 }
//               }
//               images(first: 1) { 
//                 edges { 
//                   node { 
//                     url 
//                   } 
//                 } 
//               }
//               priceRangeV2 {
//                 minVariantPrice { amount currencyCode }
//               }
//             }
//             cursor
//           }
//           pageInfo {
//             hasNextPage
//             endCursor
//           }
//         }
//       }
//     `;

//     const variables = {
//       first: 250, // Maximum allowed per request
//       after: cursor
//     };

//     const response = await axios({
//       method: "POST",
//       url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
//       headers: {
//         "Content-Type": "application/json",
//         "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
//       },
//       data: { query, variables }
//     });

//     const { data, errors } = response.data;
    
//     if (errors) {
//       console.error('GraphQL errors:', errors);
//       break;
//     }

//     // Process products and their variants
//     const products = data.products.edges.flatMap(({ node }) => {
//       // If product has variants, create entries for each variant
//       if (node.variants.edges && node.variants.edges.length > 0) {
//         return node.variants.edges.map(variantEdge => ({
//           id: `${node.id}-${variantEdge.node.id}`,
//           handle: node.handle,
//          title: variantEdge.node.title === "Default Title"
//   ? node.title
//   : `${node.title} - ${variantEdge.node.title}`,

//           productTitle: node.title,
//           variantTitle: variantEdge.node.title,
//           vendor: node.vendor,
//           tags: node.tags,
//           productType: node.productType,
//           summary: node.description ? node.description.slice(0, 200) : "",
//           imageUrl: node.images.edges[0]?.node?.url || null,
//           price: variantEdge.node.price || node.priceRangeV2.minVariantPrice.amount,
//           currency: node.priceRangeV2.minVariantPrice.currencyCode,
//           sku: variantEdge.node.sku,
//           inventoryQuantity: variantEdge.node.inventoryQuantity,
//           availableForSale: variantEdge.node.availableForSale,
//           status: node.status
//         }));
//       } else {
//         // Product without variants (fallback to original structure)
//         return [{
//           id: node.id,
//           handle: node.handle,
//           title: node.title,
//           vendor: node.vendor,
//           tags: node.tags,
//           productType: node.productType,
//           summary: node.description ? node.description.slice(0, 200) : "",
//           imageUrl: node.images.edges[0]?.node?.url || null,
//           price: node.priceRangeV2.minVariantPrice.amount,
//           currency: node.priceRangeV2.minVariantPrice.currencyCode,
//           status: node.status
//         }];
//       }
//     });

//     allProducts.push(...products);

//     hasNextPage = data.products.pageInfo.hasNextPage;
//     cursor = data.products.pageInfo.endCursor;
//   }

//   return allProducts;
// }

// // Enhanced Gemini search with better product context
// async function geminiSearch(userQuery, products) {
//   const prompt = `
// You are an intelligent e-commerce search assistant for a Shopify store.
// User query: "${userQuery}"

// Available products (${products.length} items):
// ${products.map(
//   p => `- ${p.title} | Price: ${p.price} ${p.currency} | Type: ${p.productType || 'N/A'} | Vendor: ${p.vendor} | Tags: ${p.tags.join(", ")} | ${p.summary} | Stock: ${p.availableForSale ? 'Available' : 'Unavailable'}`
// ).join("\n")}

// Instructions:
// 1. Analyze user intent and find products that best match their search
// 2. Consider product title, type, vendor, tags, description, and availability
// 3. Look for synonyms and related terms
// 4. Return ONLY titles of products that are strong matches
// 5. Prioritize available products over out-of-stock items
// 6. If nothing matches well, return empty array
// 7. Maximum 5 best matches

// Output must be strictly valid JSON only. No explanations.
// Output JSON format: { "matches": ["Product Title 1","Product Title 2"] }
// `;

//   const resp = await axios.post(
//     "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
//     {
//       contents: [{ role: "user", parts: [{ text: prompt }] }]
//     },
//     { headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY } }
//   );

//   const raw = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
//   try {
//     return JSON.parse(raw);
//   } catch (e) {
//     const match = raw.match(/\{[\s\S]*\}/);
//     return match ? JSON.parse(match[0]) : { matches: [] };
//   }
// }


// // --- Rate Limiter --- (unchanged)
// const searchLimiter = rateLimit({
//   windowMs: 60 * 1000, // 1 minute
//   max: 5,
//   standardHeaders: true,
//   legacyHeaders: false,
//   handler: (req, res) => {
//     console.warn(`Rate limit exceeded for IP: ${req.ip}`);
//     res.status(429).json({
//       error: "Too many requests",
//       details: "You can only make 5 AI search requests per minute. Please wait and try again."
//     });
//   }
// });

// // --- Enhanced API Route ---
// router.post("/", searchLimiter, async (req, res) => {
//   try {
//     const { query } = req.body;
//     if (!query) {
//       return res.status(400).json({ error: "Missing query" });
//     }

//     const products = await fetchProductsForCapsules();
//     const result = await geminiSearch(query, products);

//     // Map the titles from the AI response back to the full product objects
//    const matched = products.filter(p => result.matches.includes(p.title) && p.imageUrl);


//     res.json({ 
//       matches: matched,
//       totalProductsSearched: products.length,
//       searchQuery: query
//     });
//   } catch (err) {
//     console.error("Gemini search failed:", err.message);
//     res.status(500).json({ error: "Something went wrong!", details: err.message });
//   }
// });

// module.exports = router;

const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// Get credentials from environment variables
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, GEMINI_API_KEY } = process.env;

// --- CACHE IMPLEMENTATION ---
const searchCache = new Map();
const productCache = { data: null, timestamp: 0 };
const SEARCH_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const PRODUCT_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

// --- Helper Functions ---

// Fetches product data from Shopify for the AI prompt (with caching)
async function fetchProductsForCapsules() {
  const now = Date.now();
  
  // Return cached products if still valid
  if (productCache.data && (now - productCache.timestamp) < PRODUCT_CACHE_DURATION) {
    console.log('Returning cached products');
    return productCache.data;
  }

  console.log('Fetching fresh products from Shopify...');
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const query = `
      query getProducts($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              handle
              title
              vendor
              tags
              description
              status
              productType
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    price
                    sku
                    inventoryQuantity
                    availableForSale
                  }
                }
              }
              images(first: 1) { 
                edges { 
                  node { 
                    url 
                  } 
                } 
              }
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const variables = {
      first: 250,
      after: cursor
    };

    const response = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
      },
      data: { query, variables }
    });

    const { data, errors } = response.data;
    
    if (errors) {
      console.error('GraphQL errors:', errors);
      break;
    }

    const products = data.products.edges.flatMap(({ node }) => {
      if (node.variants.edges && node.variants.edges.length > 0) {
        return node.variants.edges.map(variantEdge => ({
          id: `${node.id}-${variantEdge.node.id}`,
          handle: node.handle,
          title: variantEdge.node.title === "Default Title"
            ? node.title
            : `${node.title} - ${variantEdge.node.title}`,
          productTitle: node.title,
          variantTitle: variantEdge.node.title,
          vendor: node.vendor,
          tags: node.tags,
          productType: node.productType,
          summary: node.description ? node.description.slice(0, 200) : "",
          imageUrl: node.images.edges[0]?.node?.url || null,
          price: variantEdge.node.price || node.priceRangeV2.minVariantPrice.amount,
          currency: node.priceRangeV2.minVariantPrice.currencyCode,
          sku: variantEdge.node.sku,
          inventoryQuantity: variantEdge.node.inventoryQuantity,
          availableForSale: variantEdge.node.availableForSale,
          status: node.status
        }));
      } else {
        return [{
          id: node.id,
          handle: node.handle,
          title: node.title,
          vendor: node.vendor,
          tags: node.tags,
          productType: node.productType,
          summary: node.description ? node.description.slice(0, 200) : "",
          imageUrl: node.images.edges[0]?.node?.url || null,
          price: node.priceRangeV2.minVariantPrice.amount,
          currency: node.priceRangeV2.minVariantPrice.currencyCode,
          status: node.status
        }];
      }
    });

    allProducts.push(...products);

    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }

  // Update cache
  productCache.data = allProducts;
  productCache.timestamp = now;
  console.log(`Cached ${allProducts.length} products`);

  return allProducts;
}

// Enhanced Gemini search with retry logic
async function geminiSearchWithRetry(userQuery, products, maxRetries = 3) {
  const prompt = `
You are an intelligent e-commerce search assistant for a Shopify store.
User query: "${userQuery}"

Available products (${products.length} items):
${products.map(
  p => `- ${p.title} | Price: ${p.price} ${p.currency} | Type: ${p.productType || 'N/A'} | Vendor: ${p.vendor} | Tags: ${p.tags.join(", ")} | ${p.summary} | Stock: ${p.availableForSale ? 'Available' : 'Unavailable'}`
).join("\n")}

Instructions:
1. Analyze user intent and find products that best match their search
2. Consider product title, type, vendor, tags, description, and availability
3. Look for synonyms and related terms
4. Return ONLY titles of products that are strong matches
5. Prioritize available products over out-of-stock items
6. If nothing matches well, return empty array
7. Maximum 5 best matches

Output must be strictly valid JSON only. No explanations.
Output JSON format: { "matches": ["Product Title 1","Product Title 2"] }
`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await axios.post(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        },
        { 
          headers: { 
            "Content-Type": "application/json", 
            "x-goog-api-key": GEMINI_API_KEY 
          },
          timeout: 30000 // 30 second timeout
        }
      );

      const raw = resp.data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      try {
        return JSON.parse(raw);
      } catch (e) {
        const match = raw.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { matches: [] };
      }

    } catch (error) {
      const status = error.response?.status;
      const isRateLimit = status === 429;
      
      console.log(`Gemini API attempt ${attempt + 1}/${maxRetries} failed:`, error.message);

      // If it's a rate limit error and we have retries left
      if (isRateLimit && attempt < maxRetries - 1) {
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
        console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // If we've exhausted retries or it's a different error
      if (isRateLimit) {
        throw new Error('Gemini API rate limit exceeded. Please try again in 30 seconds.');
      }
      
      throw error;
    }
  }
}

// --- Rate Limiter ---
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Increased from 5 to 10 since we have caching now
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many requests",
      details: "You can only make 10 AI search requests per minute. Please wait and try again."
    });
  }
});

// --- Enhanced API Route with Caching ---
router.post("/", searchLimiter, async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // Normalize query for cache key
    const cacheKey = query.toLowerCase().trim();
    const now = Date.now();

    // Check cache first
    const cached = searchCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < SEARCH_CACHE_DURATION) {
      console.log(`Returning cached search results for: "${query}"`);
      return res.json({ 
        ...cached.data,
        cached: true,
        cacheAge: Math.round((now - cached.timestamp) / 1000) + 's'
      });
    }

    // Fetch products (will use cache if available)
    const products = await fetchProductsForCapsules();
    
    // Perform Gemini search with retry logic
    const result = await geminiSearchWithRetry(query, products);

    // Map the titles from the AI response back to the full product objects
    const matched = products.filter(p => result.matches.includes(p.title) && p.imageUrl);

    const responseData = { 
      matches: matched,
      totalProductsSearched: products.length,
      searchQuery: query,
      cached: false
    };

    // Cache the successful result
    searchCache.set(cacheKey, {
      data: responseData,
      timestamp: now
    });

    // Clean old cache entries (keep cache size manageable)
    if (searchCache.size > 100) {
      const entriesToDelete = Array.from(searchCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 20)
        .map(([key]) => key);
      
      entriesToDelete.forEach(key => searchCache.delete(key));
      console.log(`Cleaned ${entriesToDelete.length} old cache entries`);
    }

    res.json(responseData);

  } catch (err) {
    console.error("Gemini search failed:", err.message);
    
    // Return user-friendly error message
    const statusCode = err.message.includes('rate limit') ? 429 : 500;
    res.status(statusCode).json({ 
      error: err.message.includes('rate limit') 
        ? "AI search is temporarily rate-limited" 
        : "Something went wrong!", 
      details: err.message 
    });
  }
});

// Optional: Add cache stats endpoint for monitoring
router.get("/cache-stats", (req, res) => {
  res.json({
    searchCacheSize: searchCache.size,
    productsCached: productCache.data ? productCache.data.length : 0,
    productCacheAge: productCache.timestamp 
      ? Math.round((Date.now() - productCache.timestamp) / 1000) + 's'
      : 'N/A'
  });
});

// Optional: Clear cache endpoint (for admin use)
router.post("/clear-cache", (req, res) => {
  searchCache.clear();
  productCache.data = null;
  productCache.timestamp = 0;
  res.json({ message: "Cache cleared successfully" });
});

module.exports = router;