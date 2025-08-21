const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

// Validate environment variables on startup
if (!SHOPIFY_STORE || !ADMIN_API_TOKEN) {
  console.error('Missing required environment variables: SHOPIFY_STORE and/or SHOPIFY_ADMIN_TOKEN');
  process.exit(1);
}

app.post("/update-customer-metafields", async (req, res) => {
  const { customerId, customer_name, business_name, customer_role, customer_phone } = req.body;

  // Input validation
  if (!customerId || !customer_name || !customer_role) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      details: 'customerId, customer_name, and customer_role are required fields'
    });
  }

  // Validate customerId is numeric
  if (!/^\d+$/.test(customerId.toString())) {
    return res.status(400).json({ 
      error: 'Invalid customerId',
      details: 'customerId must be a numeric value'
    });
  }

  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { 
          id 
          key 
          value 
          namespace
          type
        }
        userErrors { 
          field 
          message 
          code
        }
      }
    }
  `;

  const variables = {
    metafields: [
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "name",
        type: "single_line_text_field",
        value: customer_name
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "business_name",
        type: "single_line_text_field",
        value: business_name || ""
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "role",
        type: "single_line_text_field",
        value: customer_role
      },
      {
        ownerId: `gid://shopify/Customer/${customerId}`,
        namespace: "custom",
        key: "phone",
        type: "single_line_text_field",
        value: customer_phone || ""
      }
    ]
  };

  try {
    const response = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_API_TOKEN
      },
      data: { query, variables }
    });

    const result = response.data;

    // Check for GraphQL errors
    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return res.status(400).json({ 
        error: 'GraphQL errors occurred',
        details: result.errors
      });
    }

    // Check for user errors in the mutation response
    if (result.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('User errors:', result.data.metafieldsSet.userErrors);
      return res.status(400).json({ 
        error: 'Metafield validation errors',
        details: result.data.metafieldsSet.userErrors
      });
    }

    // Success response
    res.json({
      success: true,
      data: result.data.metafieldsSet.metafields,
      message: 'Customer metafields updated successfully'
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ 
      error: "Failed to update metafields",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    timestamp: new Date().toISOString(),
    shopify_store: SHOPIFY_STORE ? "configured" : "not configured"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Shopify Store: ${SHOPIFY_STORE}`);
  console.log(`Admin API Token: ${ADMIN_API_TOKEN ? 'configured' : 'not configured'}`);
});
