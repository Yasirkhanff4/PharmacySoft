export const APP_NAME = "PharmaCare";
export const APP_VERSION = "2.0.0";

export const SETTINGS_KEY = "pharmacySettings";
export const LOGO_KEY = "pharmacyLogo";
export const BACKUP_META_KEY = "pharmacyLastBackup";

export const DEFAULT_SETTINGS = {
  pharmacyName: APP_NAME,
  phone: "",
  email: "",
  address: "",
  currency: "PKR",
  invoicePrefix: "INV",
  invoiceFooter: "Thank you for your visit!",
  lowStockLimit: 10,
  expiryWarningDays: 30,
};

export const CURRENCIES = [
  { code: "PKR", symbol: "Rs.", locale: "en-PK", label: "PKR - Pakistani Rupee" },
  { code: "USD", symbol: "$", locale: "en-US", label: "USD - US Dollar" },
  { code: "EUR", symbol: "\u20ac", locale: "de-DE", label: "EUR - Euro" },
  { code: "GBP", symbol: "\u00a3", locale: "en-GB", label: "GBP - British Pound" },
  { code: "INR", symbol: "\u20b9", locale: "en-IN", label: "INR - Indian Rupee" },
  { code: "AED", symbol: "AED", locale: "en-AE", label: "AED - UAE Dirham" },
  { code: "SAR", symbol: "SAR", locale: "ar-SA", label: "SAR - Saudi Riyal" },
];

export const PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Other"];

export const EXPENSE_CATEGORIES = [
  "Rent",
  "Electricity",
  "Salaries",
  "Transport",
  "Utilities",
  "Maintenance",
  "Internet",
  "Office Supplies",
  "Other",
];

export const MEDICINE_CATEGORIES = [
  "Tablet",
  "Capsule",
  "Syrup",
  "Injection",
  "Ointment",
  "Drops",
  "Inhaler",
  "Powder",
  "Cream",
  "Other",
];

export const ROLES = {
  admin: {
    label: "Administrator",
    description: "Full access including settings, users, and backups.",
  },
  pharmacist: {
    label: "Pharmacist",
    description: "Manages inventory, sales, purchases and reports. No system administration.",
  },
  cashier: {
    label: "Cashier",
    description: "Processes sales and views inventory/history. No purchases or reports.",
  },
};

export const PERMISSIONS = {
  admin: [
    "dashboard.view",
    "medicines.view",
    "medicines.manage",
    "pos.use",
    "sales.view",
    "sales.cancel",
    "purchases.view",
    "purchases.manage",
    "suppliers.view",
    "suppliers.manage",
    "customers.view",
    "customers.manage",
    "expenses.view",
    "expenses.manage",
    "reports.view",
    "settings.view",
    "settings.manage",
    "backup.manage",
    "users.manage",
  ],
  pharmacist: [
    "dashboard.view",
    "medicines.view",
    "medicines.manage",
    "pos.use",
    "sales.view",
    "sales.cancel",
    "purchases.view",
    "purchases.manage",
    "suppliers.view",
    "suppliers.manage",
    "customers.view",
    "customers.manage",
    "expenses.view",
    "expenses.manage",
    "reports.view",
  ],
  cashier: [
    "dashboard.view",
    "medicines.view",
    "pos.use",
    "sales.view",
    "customers.view",
    "customers.manage",
  ],
};

export function hasPermission(role, permission) {
  if (!role) return false;
  const list = PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}

export const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { name: "Dashboard", path: "/", icon: "dashboard", permission: "dashboard.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { name: "POS / Billing", path: "/pos", icon: "pos", permission: "pos.use" },
      { name: "Sales History", path: "/sales-history", icon: "sales", permission: "sales.view" },
      { name: "Purchases", path: "/purchases", icon: "purchases", permission: "purchases.view" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { name: "Medicines", path: "/medicines", icon: "medicines", permission: "medicines.view" },
      { name: "Suppliers", path: "/suppliers", icon: "suppliers", permission: "suppliers.view" },
    ],
  },
  {
    label: "People",
    items: [
      { name: "Customers", path: "/customers", icon: "customers", permission: "customers.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { name: "Expenses", path: "/expenses", icon: "expenses", permission: "expenses.view" },
      { name: "Reports", path: "/reports", icon: "reports", permission: "reports.view" },
    ],
  },
  {
    label: "System",
    items: [
      { name: "Settings", path: "/settings", icon: "settings", permission: "settings.view" },
    ],
  },
];
