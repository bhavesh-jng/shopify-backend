const nodemailer = require('nodemailer');
const express = require("express");
const { PhoneNumberUtil, PhoneNumberFormat } = require('google-libphonenumber');
const { db } = require("../firebaseConfig.js");
const router = express.Router();

// Initialize phone number utility
const phoneUtil = PhoneNumberUtil.getInstance();

// Get email credentials from environment variables
const { EMAIL_PASS, EMAIL_USER } = process.env;

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

async function sendAdminNotification(customerData) {
  const emailContent = `
    <h2>New Customer Profile Created - Verification Required</h2>
    
    <h3>Customer Details:</h3>
    <ul>
      <li><strong>Name:</strong> ${customerData.customer_name}</li>
      <li><strong>Email:</strong> ${customerData.customer_email || 'Not provided'}</li>
      <li><strong>Phone:</strong> ${customerData.customer_phone || 'Not provided'}</li>
      <li><strong>Country:</strong> ${customerData.country}</li>
      <li><strong>Role:</strong> ${customerData.customer_role}</li>
    </ul>
    
    <h3>Business Information:</h3>
    <ul>
      <li><strong>Company:</strong> ${customerData.business_name}</li>
      <li><strong>Website:</strong> ${customerData.domain_name || 'Not provided'}</li>
      <li><strong>Employees:</strong> ${customerData.number_of_employees}</li>
      ${customerData.customer_role === 'Buyer' ? 
        `<li><strong>Retailer Type:</strong> ${customerData.retailer_type || 'Not specified'}</li>` : 
        `<li><strong>Supplier Type:</strong> ${customerData.supplier_type || 'Not specified'}</li>
         <li><strong>Registration #:</strong> ${customerData.business_registration || 'Not provided'}</li>`
      }
    </ul>
    
    <p><strong>Customer ID:</strong> ${customerData.customerId}</p>
    <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
    
    <p>Please review and verify this customer profile.</p>
  `;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_EMAIL,
    subject: `New ${customerData.customer_role} Profile - ${customerData.business_name}`,
    html: emailContent
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Admin notification email sent successfully');
  } catch (error) {
    console.error('Failed to send admin notification:', error);
    // Don't fail the main request if email fails
  }
}

// Phone validation function
function validatePhoneNumber(phoneNumber, countryCode) {
  if (!phoneNumber || !phoneNumber.trim()) {
    return { isValid: true, formattedNumber: '' }; // Phone is optional
  }

  try {
    const number = phoneUtil.parseAndKeepRawInput(phoneNumber, countryCode);
    const isValid = phoneUtil.isValidNumber(number);
    
    if (!isValid) {
      return { isValid: false, error: 'Invalid phone number format' };
    }

    const formattedNumber = phoneUtil.format(number, PhoneNumberFormat.INTERNATIONAL);
    return { isValid: true, formattedNumber };
  } catch (error) {
    return { isValid: false, error: 'Invalid phone number format' };
  }
}

// Country code mapping for phone validation
const countryToPhoneCode = {
  'United States': 'US',
  'Canada': 'CA',
  'United Kingdom': 'GB',
  'Germany': 'DE',
  'France': 'FR',
  'Australia': 'AU',
  'Japan': 'JP',
  'India': 'IN',
  'China': 'CN',
  'Brazil': 'BR',
  'Mexico': 'MX',
  'Other': 'US' // Default to US format for 'Other'
};

// POST / - Create or update customer metafields
router.post("/", async (req, res) => {
  const { 
    customerId, 
    customer_name,
    customer_email, 
    business_name, 
    customer_role, 
    customer_phone,
    country,
    domain_name,
    number_of_employees,
    retailer_type,
    supplier_type,
    business_registration
  } = req.body;

  // Input validation
  if (!customerId || !customer_name || !customer_role || !country || !business_name || !number_of_employees) {
    return res.status(400).json({
      error: 'Missing required fields',
      details: 'customerId, customer_name, customer_role, country, business_name, and number_of_employees are required fields'
    });
  }

  // Validate role
  if (!['Buyer', 'Supplier/Vendor'].includes(customer_role)) {
    return res.status(400).json({
      error: 'Invalid customer role',
      details: 'customer_role must be either "Buyer" or "Supplier/Vendor"'
    });
  }

  // Validate URL format if domain_name is provided
  if (domain_name && domain_name.trim() && !/^https?:\/\/.+\..+/.test(domain_name.trim())) {
    return res.status(400).json({
      error: 'Invalid website URL',
      details: 'domain_name must be a valid URL starting with http:// or https://'
    });
  }

  // Validate phone number using Google libphonenumber
  const phoneCountryCode = countryToPhoneCode[country] || 'US';
  const phoneValidation = validatePhoneNumber(customer_phone, phoneCountryCode);
  
  if (!phoneValidation.isValid) {
    return res.status(400).json({
      error: 'Invalid phone number',
      details: phoneValidation.error + ` for ${country}`
    });
  }

  // Use formatted phone number if validation passed
  const formattedPhone = phoneValidation.formattedNumber;

  // Validate employee count
  const validEmployeeCounts = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
  if (!validEmployeeCounts.includes(number_of_employees)) {
    return res.status(400).json({
      error: 'Invalid employee count',
      details: 'number_of_employees must be one of: ' + validEmployeeCounts.join(', ')
    });
  }

  // Prepare customer data for Firestore
  const customerData = {
    customerId: customerId.toString(),
    customerName: customer_name,
    businessName: business_name,
    role: customer_role,
    contact: formattedPhone || "",
    email: customer_email || "",
    country: country,
    domain: domain_name || "",
    numberOfEmployees: number_of_employees,
    isVerified: false, // Default to false for new customers
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Add role-specific fields
  if (customer_role === 'Buyer' && retailer_type) {
    customerData.retailerType = retailer_type;
  }

  if (customer_role === 'Supplier/Vendor') {
    if (supplier_type) {
      customerData.supplierType = supplier_type;
    }
    if (business_registration) {
      customerData.businessRegistration = business_registration;
    }
  }

  try {
    // Check if customer exists
    const customerRef = db.collection('customers').doc(customerId.toString());
    const doc = await customerRef.get();
    
    if (doc.exists) {
      // Update existing customer
      delete customerData.createdAt; // Don't update creation date
      await customerRef.update(customerData);
      console.log(`Successfully updated customer ${customerId}:`, customerData);
    } else {
      // Create new customer
      await customerRef.set(customerData);
      console.log(`Successfully created customer ${customerId}:`, customerData);
    }

    // Send admin notification
    await sendAdminNotification({ ...req.body, customer_email });

    res.json({
      success: true,
      data: customerData,
      message: doc.exists ? 'Customer profile updated successfully' : 'Customer profile created successfully'
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    return res.status(500).json({
      error: "Failed to update customer data",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// GET /customer/:customerId - Retrieve specific customer data
router.get("/customer/:customerId", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: 'Invalid customerId',
      details: 'customerId is required'
    });
  }

  try {
    const customerRef = db.collection('customers').doc(customerId.toString());
    const doc = await customerRef.get();

    if (!doc.exists) {
      return res.status(404).json({
        error: 'Customer not found',
        details: `No customer found with ID: ${customerId}`
      });
    }

    const customerData = doc.data();
    
    res.json({
      success: true,
      data: {
        id: doc.id,
        ...customerData
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    res.status(500).json({
      error: "Failed to retrieve customer data",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// GET /customers - Retrieve all customers with pagination
router.get("/customers", async (req, res) => {
  const { 
    limit = 50, 
    startAfter, 
    role, 
    isVerified,
    country,
    sortBy = 'createdAt',
    sortOrder = 'desc' 
  } = req.query;

  try {
    let query = db.collection('customers');

    // Apply filters
    if (role) {
      query = query.where('role', '==', role);
    }
    
    if (isVerified !== undefined) {
      query = query.where('isVerified', '==', isVerified === 'true');
    }
    
    if (country) {
      query = query.where('country', '==', country);
    }

    // Apply sorting
    query = query.orderBy(sortBy, sortOrder);

    // Apply pagination
    const limitNum = Math.min(parseInt(limit), 100); // Max 100 per page
    query = query.limit(limitNum);

    if (startAfter) {
      // For pagination, we need to get the document to start after
      const startAfterDoc = await db.collection('customers').doc(startAfter).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }

    // Execute query
    const snapshot = await query.get();
    
    const customers = [];
    let lastDocId = null;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      customers.push({
        id: doc.id,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        email: data.email || '',
        phone: data.contact || '',
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
        tags: data.tags || [],
        // Custom fields
        customerName: data.customerName || '',
        businessName: data.businessName || '',
        role: data.role || '',
        contact: data.contact || '',
        isVerified: data.isVerified || false,
        country: data.country || '',
        domainName: data.domain || '',
        numberOfEmployees: data.numberOfEmployees || '',
        retailerType: data.retailerType || '',
        supplierType: data.supplierType || '',
        businessRegistration: data.businessRegistration || ''
      });
      lastDocId = doc.id;
    });

    // Check if there are more documents
    const hasNextPage = customers.length === limitNum;

    res.json({
      success: true,
      data: {
        customers: customers,
        pageInfo: {
          hasNextPage: hasNextPage,
          lastDocId: lastDocId,
          totalCount: customers.length
        }
      }
    });

  } catch (err) {
    console.error('Unexpected error:', err.message);
    return res.status(500).json({
      error: "Failed to retrieve customers",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// POST /verify - Update customer verification status
router.post("/verify", async (req, res) => {
  const { customerId, isVerified } = req.body;

  // Input Validation
  if (!customerId) {
    return res.status(400).json({
      error: 'Missing required field',
      details: 'customerId is a required field'
    });
  }

  if (typeof isVerified !== 'boolean') {
    return res.status(400).json({
      error: 'Invalid isVerified value',
      details: 'isVerified must be a boolean (true or false)'
    });
  }

  try {
    const customerRef = db.collection('customers').doc(customerId.toString());
    
    // Check if customer exists
    const doc = await customerRef.get();
    if (!doc.exists) {
      return res.status(404).json({
        error: 'Customer not found',
        details: `No customer found with ID: ${customerId}`
      });
    }

    // Update verification status
    await customerRef.update({
      isVerified: isVerified,
      updatedAt: new Date().toISOString(),
      verifiedAt: isVerified ? new Date().toISOString() : null
    });

    console.log(`Successfully updated isVerified status for customer ${customerId} to ${isVerified}`);

    res.json({
      success: true,
      message: `Customer verification status updated to ${isVerified}`,
      data: {
        customerId: customerId,
        isVerified: isVerified,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Unexpected error during verification update:', err.message);
    return res.status(500).json({
      error: "Failed to update verification status",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// DELETE /customer/:customerId - Delete a customer (optional endpoint)
router.delete("/customer/:customerId", async (req, res) => {
  const { customerId } = req.params;

  if (!customerId) {
    return res.status(400).json({
      error: 'Invalid customerId',
      details: 'customerId is required'
    });
  }

  try {
    const customerRef = db.collection('customers').doc(customerId.toString());
    
    // Check if customer exists
    const doc = await customerRef.get();
    if (!doc.exists) {
      return res.status(404).json({
        error: 'Customer not found',
        details: `No customer found with ID: ${customerId}`
      });
    }

    // Delete the customer
    await customerRef.delete();
    
    console.log(`Successfully deleted customer ${customerId}`);

    res.json({
      success: true,
      message: `Customer ${customerId} deleted successfully`
    });

  } catch (err) {
    console.error('Unexpected error during deletion:', err.message);
    return res.status(500).json({
      error: "Failed to delete customer",
      details: err.message || 'An unexpected error occurred'
    });
  }
});

// Export the router to be used in server.js
module.exports = router;