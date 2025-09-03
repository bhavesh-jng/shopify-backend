const express = require('express');
const axios = require('axios');
const router = express.Router();

const { SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN } = process.env;

// Helper for Shopify REST API requests
const shopifyApi = axios.create({
  baseURL: `https://${SHOPIFY_STORE}/admin/api/2025-07`,
  headers: {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
  }
});

// Fetch all customer lists
router.get('/get', async (req, res) => {
  const { customerId } = req.query;
  if (!customerId) return res.status(400).json({ error: 'Missing customerId' });

  try {
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=favList`);
    const metafield = (response.data.metafields || [])[0];
    let listNames = [];
    if (metafield && metafield.value) {
      listNames = JSON.parse(metafield.value);
    }
    res.json({ success: true, lists: listNames });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add a new list name to the metafield
router.post('/add', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) return res.status(400).json({ error: 'Missing customerId or listName' });

  try {
    // Fetch existing
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=favList`);
    let listNames = [];
    let metafieldId = null;
    if (response.data.metafields && response.data.metafields[0]) {
      metafieldId = response.data.metafields[0].id;
      listNames = JSON.parse(response.data.metafields[0].value);
    }

    if (listNames.includes(listName)) {
      return res.json({ success: true, message: 'List already exists', lists: listNames });
    }

    // Add new list name
    listNames.push(listName);

    const payload = {
      metafield: {
        namespace: 'custom',
        key: 'favList',
        value: JSON.stringify(listNames),
        type: 'list.single_line_text_field'
      }
    };

    let saveResp;
    if (metafieldId) {
      saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);
    } else {
      saveResp = await shopifyApi.post(`/customers/${customerId}/metafields.json`, payload);
    }

    res.json({ success: true, lists: listNames, metafield: saveResp.data.metafield });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// **NEW: Fetch products for a specific list**
router.post('/products', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) return res.status(400).json({ error: 'Missing customerId or listName' });

  try {
    // Use a sanitized list name for the metafield key
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Fetch the specific list's products from metafield
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    let productIds = [];
    const metafield = (response.data.metafields || [])[0];
    if (metafield && metafield.value) {
      try {
        productIds = JSON.parse(metafield.value);
      } catch (parseError) {
        console.error('Error parsing product IDs:', parseError);
        return res.json({ success: true, products: [] });
      }
    }

    if (!productIds.length) {
      return res.json({ success: true, products: [] });
    }

    // **REUSE YOUR EXISTING GRAPHQL LOGIC FROM getcustomerwishlist.js**
    const productsWithDetails = await fetchProductDetailsUsingGraphQL(productIds);

    res.json({ success: true, products: productsWithDetails });
  } catch (error) {
    console.error('Error fetching list products:', error);
    res.status(500).json({ error: error.message });
  }
});

// **NEW: Add product to a specific list**
router.post('/add-product', async (req, res) => {
  const { customerId, listName, productId } = req.body;
  if (!customerId || !listName || !productId) {
    return res.status(400).json({ error: 'Missing customerId, listName, or productId' });
  }

  try {
    // Use a sanitized list name for the metafield key
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Fetch existing products for this list
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    let productIds = [];
    let metafieldId = null;
    
    const metafield = (response.data.metafields || [])[0];
    if (metafield) {
      metafieldId = metafield.id;
      try {
        productIds = JSON.parse(metafield.value) || [];
      } catch (parseError) {
        productIds = [];
      }
    }

    // **REUSE YOUR EXISTING LOGIC - Convert to GID format like your wishlist**
    const productGid = `gid://shopify/Product/${productId}`;

    // Check if product already exists in the list
    if (productIds.includes(productGid)) {
      return res.json({ success: true, message: 'Product already in list', products: productIds });
    }

    // Add new product GID (consistent with your wishlist format)
    productIds.push(productGid);

    const payload = {
      metafield: {
        namespace: 'custom',
        key: metafieldKey,
        value: JSON.stringify(productIds),
        type: 'list.product_reference' // Same type as your wishlist
      }
    };

    let saveResp;
    if (metafieldId) {
      saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);
    } else {
      saveResp = await shopifyApi.post(`/customers/${customerId}/metafields.json`, payload);
    }

    res.json({ success: true, products: productIds, metafield: saveResp.data.metafield });
  } catch (error) {
    console.error('Error adding product to list:', error);
    res.status(500).json({ error: error.message });
  }
});

// **NEW: Remove product from a specific list**
router.post('/remove-product', async (req, res) => {
  const { customerId, listName, productId } = req.body;
  if (!customerId || !listName || !productId) {
    return res.status(400).json({ error: 'Missing customerId, listName, or productId' });
  }

  try {
    // Use a sanitized list name for the metafield key
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Fetch existing products for this list
    const response = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    let productIds = [];
    let metafieldId = null;
    
    const metafield = (response.data.metafields || [])[0];
    if (metafield) {
      metafieldId = metafield.id;
      try {
        productIds = JSON.parse(metafield.value) || [];
      } catch (parseError) {
        return res.status(404).json({ error: 'List not found or invalid' });
      }
    } else {
      return res.status(404).json({ error: 'List not found' });
    }

    // **REUSE YOUR EXISTING REMOVAL LOGIC from updatecustomer.js**
    const productGid = `gid://shopify/Product/${productId}`;
    const numericId = productId.toString();
    
    const initialCount = productIds.length;
    
    // Use the same filtering logic as your wishlist removal
    productIds = productIds.filter((item) => {
      const itemStr = item.toString();
      return itemStr !== productGid &&           
             itemStr !== numericId &&            
             itemStr !== `gid://shopify/Product/${itemStr}` && 
             itemStr.replace('gid://shopify/Product/', '') !== numericId;
    });

    // If the list hasn't changed, the item wasn't there
    if (productIds.length === initialCount) {
      return res.json({ 
        success: true, 
        message: "Product not found in list.",
        productId: productId
      });
    }

    const payload = {
      metafield: {
        id: metafieldId,
        value: JSON.stringify(productIds),
      }
    };

    const saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);

    res.json({ 
      success: true, 
      products: productIds, 
      message: 'Product removed from list',
      metafield: saveResp.data.metafield 
    });
  } catch (error) {
    console.error('Error removing product from list:', error);
    res.status(500).json({ error: error.message });
  }
});

// **NEW: Delete a list entirely**
router.post('/delete', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) {
    return res.status(400).json({ error: 'Missing customerId or listName' });
  }

  try {
    // First remove the list name from the main favList metafield
    const listResponse = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=favList`);
    
    let listNames = [];
    let listMetafieldId = null;
    
    if (listResponse.data.metafields && listResponse.data.metafields[0]) {
      listMetafieldId = listResponse.data.metafields[0].id;
      listNames = JSON.parse(listResponse.data.metafields[0].value);
    }

    // Remove the list name
    const updatedListNames = listNames.filter(name => name !== listName);

    // Update the main list metafield
    if (listMetafieldId) {
      const listPayload = {
        metafield: {
          namespace: 'custom',
          key: 'favList',
          value: JSON.stringify(updatedListNames),
          type: 'list.single_line_text_field'
        }
      };
      await shopifyApi.put(`/metafields/${listMetafieldId}.json`, listPayload);
    }

    // Delete the products metafield for this list
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const productResponse = await shopifyApi.get(`/customers/${customerId}/metafields.json?namespace=custom&key=${metafieldKey}`);
    
    if (productResponse.data.metafields && productResponse.data.metafields[0]) {
      const productMetafieldId = productResponse.data.metafields[0].id;
      await shopifyApi.delete(`/metafields/${productMetafieldId}.json`);
    }

    res.json({ 
      success: true, 
      message: 'List deleted successfully', 
      lists: updatedListNames 
    });
  } catch (error) {
    console.error('Error deleting list:', error);
    res.status(500).json({ error: error.message });
  }
});

// **REUSED FUNCTION: GraphQL product fetching from your getcustomerwishlist.js**
async function fetchProductDetailsUsingGraphQL(productIds) {
  // Shopify GraphQL Fetcher (copied from your code)
  async function shopifyGraphQL(query, variables = {}) {
    const url = `https://${process.env.SHOPIFY_STORE}/admin/api/2025-07/graphql.json`;

    try {
      const response = await axios({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
        },
        data: JSON.stringify({ query, variables }),
      });

      if (response.data.errors) {
        throw new Error(JSON.stringify(response.data.errors));
      }

      return response.data.data;
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Shopify GraphQL error: ${error.response.status} ${error.response.statusText} - ${JSON.stringify(error.response.data)}`
        );
      } else {
        throw new Error(`Shopify GraphQL request failed: ${error.message}`);
      }
    }
  }

  // Helper function to normalize product IDs (copied from your code)
  function normalizeProductId(id) {
    if (typeof id === 'string') {
      if (id.includes('gid://shopify/Product/')) {
        return id.split('/').pop();
      }
      return id;
    }
    return id.toString();
  }

  // Normalize all product IDs and create GraphQL IDs
  const productGIDs = productIds.map(id => {
    const numericId = normalizeProductId(id);
    return `gid://shopify/Product/${numericId}`;
  });

  const productQuery = `
    query getProducts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          handle
          vendor
          featuredImage { url }
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                namespace
                key
                value
                reference {
                  ... on GenericFile{
                    url
                  }
                  ... on MediaImage {
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const productsResp = await shopifyGraphQL(productQuery, { ids: productGIDs });

  // Format products (copied from your code)
  const products = (productsResp.nodes || []).map((product) => {
    if (!product) return null;

    const metafields = product.metafields.edges.map((edge) => edge.node);

    return {
      id: product.id.replace("gid://shopify/Product/", ""),
      title: product.title,
      handle: product.handle,
      vendor: product.vendor || "",
      featured_image: product.featuredImage?.url || "/assets/no-image.png",
      product_code: metafields.find((m) => m.key === "product_code")?.value || "",
      catalogue_pdf: metafields.find((m) => m.key === "catalogue_pdf")?.reference?.url || null,
      group_catalogue: metafields.find((m) => m.key === "group_catalogue")?.reference?.image?.url || null,
    };
  }).filter(Boolean);

  // Keep order as per list
  const orderedProducts = productIds
    .map((id) => {
      const numericId = normalizeProductId(id);
      return products.find((p) => p.id === numericId);
    })
    .filter(Boolean);

  return orderedProducts;
}

module.exports = router;
