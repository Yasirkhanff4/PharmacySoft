
import Dexie from "dexie";

export const db = new Dexie("PharmacyDatabase");

// Version 1: Medicines and sync queue
db.version(1).stores({
  medicines: "id, name, barcode, batch, expiry",
  syncQueue: "++id, table, recordId, operation, status, createdAt",
});

// Version 2: Sales records
db.version(2).stores({
  medicines: "id, name, barcode, batch, expiry",
  syncQueue: "++id, table, recordId, operation, status, createdAt",
  sales: "id, invoiceNumber, customerName, createdAt",
});

// Version 3: Suppliers management
db.version(3).stores({
  medicines: "id, name, barcode, batch, expiry",
  syncQueue: "++id, table, recordId, operation, status, createdAt",
  sales: "id, invoiceNumber, customerName, createdAt",
  suppliers: "id, name, phone, email",
});

// Version 4: Purchases management
db.version(4).stores({
  medicines: "id, name, barcode, batch, expiry",
  syncQueue: "++id, table, recordId, operation, status, createdAt",
  sales: "id, invoiceNumber, customerName, createdAt",
  suppliers: "id, name, phone, email",
  purchases: "id, invoiceNumber, supplierId, supplierName, createdAt",
});

// Version 5: Customers management
db.version(5).stores({
  medicines: "id, name, barcode, batch, expiry",
  syncQueue: "++id, table, recordId, operation, status, createdAt",
  sales: "id, invoiceNumber, customerName, createdAt",
  suppliers: "id, name, phone, email",
  purchases: "id, invoiceNumber, supplierId, supplierName, createdAt",
  customers: "id, name, phone, email",
});

// Version 6: Expenses management
db.version(6).stores({
  medicines: "id, name, barcode, batch, expiry",
  syncQueue: "++id, table, recordId, operation, status, createdAt",
  sales: "id, invoiceNumber, customerName, createdAt",
  suppliers: "id, name, phone, email",
  purchases: "id, invoiceNumber, supplierId, supplierName, createdAt",
  customers: "id, name, phone, email",
  expenses: "id, title, category, date, paymentMethod",
});
