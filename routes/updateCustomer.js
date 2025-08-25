const express = require("express");

const axios = require("axios");
const router = express.Router();


// Get Shopify credentials from environment variables
const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } = process.env;

// The route is now POST /, because the base path '/update-customer-metafields' is defined in server.js
router.post("/", async (req, res) => {
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
        metafields { id key value namespace type }
        userErrors { field message code }
      }
    }
  `;

  // Construct the metafields array based on the expected types
  const metafieldsPayload = [
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
      type: "number_integer",
      value: customer_phone ? customer_phone.toString() : ""
    }
  ];

  const variables = {
    metafields: metafieldsPayload
  };

  try {
    const response = await axios({
      method: "POST",
      url: `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
      },
      data: { query, variables }
    });

    const result = response.data;

    if (result.errors) {
      console.error('GraphQL errors:', result.errors);
      return res.status(400).json({
        error: 'GraphQL errors occurred',
        details: result.errors
      });
    }

    if (result.data?.metafieldsSet?.userErrors?.length > 0) {
      console.error('User errors:', result.data.metafieldsSet.userErrors);
      return res.status(400).json({
        error: 'Metafield validation errors',
        details: result.data.metafieldsSet.userErrors
      });
    }

    res.json({
      success: true,
      data: result.data.metafieldsSet.metafields,
      message: 'Customer metafields updated successfully'
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    res.status(500).json({
      error: "Failed to update metafields",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// Export the router to be used in server.js
module.exports = router;