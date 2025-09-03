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

// **NEW ENDPOINT: Fetch products for a specific list**
router.post('/products', async (req, res) => {
  const { customerId, listName } = req.body;
  if (!customerId || !listName) return res.status(400).json({ error: 'Missing customerId or listName' });

  try {
    // Fetch the specific list's products from metafield
    const metafieldKey = `favList_${listName.replace(/[^a-zA-Z0-9]/g, '_')}`;
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

    // Fetch product details for each product ID
    const products = [];
    for (const productId of productIds) {
      try {
        const productResponse = await shopifyApi.get(`/products/${productId}.json`);
        const product = productResponse.data.product;
        
        // Format product data for frontend
        const formattedProduct = {
          id: product.id,
          title: product.title,
          handle: product.handle,
          vendor: product.vendor,
          product_code: product.variants?.[0]?.sku || '',
          featured_image: product.image?.src || (product.images?.[0]?.src || ''),
          price: product.variants?.[0]?.price || '0.00',
          compare_at_price: product.variants?.[0]?.compare_at_price || null,
          // Add catalogue fields if they exist in metafields
          catalogue_pdf: null,
          group_catalogue: null
        };

        // Check for catalogue metafields on the product
        try {
          const productMetafields = await shopifyApi.get(`/products/${productId}/metafields.json`);
          const cataloguePdf = productMetafields.data.metafields.find(m => 
            m.namespace === 'custom' && m.key === 'catalogue_pdf'
          );
          const groupCatalogue = productMetafields.data.metafields.find(m => 
            m.namespace === 'custom' && m.key === 'group_catalogue'
          );
          
          if (cataloguePdf) formattedProduct.catalogue_pdf = cataloguePdf.value;
          if (groupCatalogue) formattedProduct.group_catalogue = groupCatalogue.value;
        } catch (metafieldError) {
          console.warn(`Could not fetch metafields for product ${productId}:`, metafieldError.message);
        }

        products.push(formattedProduct);
      } catch (productError) {
        console.warn(`Could not fetch product ${productId}:`, productError.message);
        // Continue with other products even if one fails
      }
    }

    res.json({ success: true, products });
  } catch (error) {
    console.error('Error fetching list products:', error);
    res.status(500).json({ error: error.message });
  }
});

// **NEW ENDPOINT: Add product to a specific list**
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

    // Check if product already exists in the list
    if (productIds.includes(productId.toString())) {
      return res.json({ success: true, message: 'Product already in list', products: productIds });
    }

    // Add new product ID
    productIds.push(productId.toString());

    const payload = {
      metafield: {
        namespace: 'custom',
        key: metafieldKey,
        value: JSON.stringify(productIds),
        type: 'json'
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

// **NEW ENDPOINT: Remove product from a specific list**
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

    // Remove product ID from array
    const updatedProductIds = productIds.filter(id => id !== productId.toString());

    const payload = {
      metafield: {
        namespace: 'custom',
        key: metafieldKey,
        value: JSON.stringify(updatedProductIds),
        type: 'json'
      }
    };

    const saveResp = await shopifyApi.put(`/metafields/${metafieldId}.json`, payload);

    res.json({ 
      success: true, 
      products: updatedProductIds, 
      message: 'Product removed from list',
      metafield: saveResp.data.metafield 
    });
  } catch (error) {
    console.error('Error removing product from list:', error);
    res.status(500).json({ error: error.message });
  }
});

// **NEW ENDPOINT: Delete a list entirely**
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

module.exports = router;
