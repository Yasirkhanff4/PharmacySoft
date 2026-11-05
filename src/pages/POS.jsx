import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Minus,
  Plus,
  Printer,
  Receipt,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useSettings, useLogo } from "../hooks/useSettings";
import { useUI } from "../context/UIContext";
import {
  Badge,
  EmptyState,
  Field,
  LoadingBlock,
  PageHeader,
  StatTile,
} from "../components/ui/primitives";
import InvoiceView from "../components/InvoiceView";
import {
  expiryInfo,
  formatMoney,
  generateInvoiceNumber,
  getStockStatus,
  isNonNegativeNumber,
  isValidPhone,
  normalizeKey,
  normalizeText,
  roundMoney,
  todayISO,
  toDisplayDate,
} from "../lib/format";
import { PAYMENT_METHODS } from "../lib/constants";
import { printSaleInvoice } from "../lib/print";

const EMPTY_CUSTOMER = { id: "", name: "", phone: "" };

export default function POS() {
  const settings = useSettings();
  const logo = useLogo();
  const { user } = useAuth();
  const { toast, confirm } = useUI();
  const navigate = useNavigate();

  const [medicines, setMedicines] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(EMPTY_CUSTOMER);
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [amountPaid, setAmountPaid] = useState("");
  const [notes, setNotes] = useState("");
  const [attempted, setAttempted] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const checkoutLock = useRef(false);
  const searchRef = useRef(null);

  const lowLimit = Number(settings.lowStockLimit) || 10;
  const warningDays = Number(settings.expiryWarningDays) || 30;

  async function loadData() {
    try {
      setError("");
      const [medicineRecords, customerRecords] = await Promise.all([
        db.medicines.toArray(),
        db.customers.toArray(),
      ]);
      setMedicines(medicineRecords);
      setCustomers(customerRecords);
    } catch (loadError) {
      console.error("POS loading failed:", loadError);
      setError("Unable to load inventory or customers. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body to avoid a synchronous cascading render.
    Promise.resolve().then(loadData);
  }, []);

  useEffect(() => {
    if (!lastSale) {
      const timer = window.setTimeout(() => searchRef.current?.focus(), 120);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [lastSale]);

  const enriched = useMemo(
    () =>
      medicines.map((medicine) => ({
        ...medicine,
        __stock: getStockStatus(medicine.quantity, lowLimit),
        __expiry: expiryInfo(medicine.expiry, warningDays),
      })),
    [medicines, lowLimit, warningDays]
  );

  const filtered = useMemo(() => {
    const term = normalizeKey(search);
    const list = term
      ? enriched.filter((medicine) =>
          [medicine.name, medicine.genericName, medicine.barcode, medicine.batch, medicine.company]
            .some((value) => normalizeKey(value).includes(term))
        )
      : enriched;

    return [...list]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .slice(0, 60);
  }, [enriched, search]);

  const subtotal = useMemo(
    () =>
      roundMoney(
        cart.reduce(
          (total, item) => total + Number(item.unitPrice || 0) * Number(item.quantity || 0),
          0
        )
      ),
    [cart]
  );

  const discountNumber = Number(discount);
  const discountValue =
    Number.isFinite(discountNumber) && discountNumber > 0 ? roundMoney(discountNumber) : 0;
  const grandTotal = roundMoney(Math.max(0, subtotal - discountValue));
  const totalItems = cart.reduce((total, item) => total + Number(item.quantity || 0), 0);

  const hasDiscountInput = normalizeText(discount) !== "";
  const discountError = !hasDiscountInput
    ? ""
    : !Number.isFinite(discountNumber) || discountNumber < 0
      ? "Enter a valid discount amount."
      : discountNumber > subtotal
        ? `Discount cannot be more than the bill total (${formatMoney(subtotal, settings)}).`
        : "";

  const cleanCustomerName = normalizeText(customer.name);
  const cleanCustomerPhone = normalizeText(customer.phone);
  const customerNameError =
    attempted && !cleanCustomerName ? "Customer name is required." : "";
  const customerPhoneError = !cleanCustomerPhone
    ? attempted
      ? "Phone number is required."
      : ""
    : !isValidPhone(cleanCustomerPhone)
      ? "Enter a valid phone number."
      : "";

  const hasAmountPaidInput = normalizeText(amountPaid) !== "";
  const amountPaidNumber = Number(amountPaid);
  const effectiveAmountPaid = hasAmountPaidInput ? amountPaidNumber : grandTotal === 0 ? 0 : NaN;
  const amountPaidIsValid = Number.isFinite(effectiveAmountPaid) && effectiveAmountPaid >= 0;
  const amountPaidValue = amountPaidIsValid ? roundMoney(effectiveAmountPaid) : 0;
  const changeDue = amountPaidIsValid
    ? roundMoney(Math.max(0, effectiveAmountPaid - grandTotal))
    : 0;
  const balanceDue = amountPaidIsValid
    ? roundMoney(Math.max(0, grandTotal - effectiveAmountPaid))
    : grandTotal;
  const paymentError = !hasAmountPaidInput
    ? grandTotal === 0
      ? ""
      : attempted
        ? "Enter the amount received from the customer."
        : ""
    : !Number.isFinite(amountPaidNumber) || amountPaidNumber < 0
      ? "Enter a valid amount received."
      : amountPaidNumber < grandTotal
        ? `Amount received is short by ${formatMoney(
            roundMoney(grandTotal - amountPaidNumber),
            settings
          )}.`
        : "";

  function addToCart(medicine) {
    setError("");

    if (medicine.__expiry?.status === "expired") {
      toast.error(
        `${medicine.name} (batch ${medicine.batch || "—"}) expired on ${toDisplayDate(
          medicine.expiry
        )} and cannot be sold.`,
        "Expired medicine"
      );
      return;
    }

    const stock = Number(medicine.quantity) || 0;

    if (stock <= 0) {
      toast.error(`${medicine.name} is out of stock.`, "Out of stock");
      return;
    }

    setCart((previous) => {
      const existing = previous.find((item) => item.medicineId === medicine.id);

      if (existing) {
        if (existing.quantity >= existing.availableStock) {
          toast.error(
            `Only ${existing.availableStock} units of ${medicine.name} are in stock.`,
            "Stock limit reached"
          );
          return previous;
        }

        return previous.map((item) =>
          item.medicineId === medicine.id
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.unitPrice }
            : item
        );
      }

      return [
        ...previous,
        {
          medicineId: medicine.id,
          name: medicine.name,
          barcode: medicine.barcode || "",
          batch: medicine.batch || "",
          expiry: medicine.expiry || "",
          unitPrice: Number(medicine.salePrice) || 0,
          costPrice: Number(medicine.purchasePrice) || 0,
          quantity: 1,
          availableStock: stock,
          total: Number(medicine.salePrice) || 0,
        },
      ];
    });

    setSearch("");
    searchRef.current?.focus();
  }

  function handleSearchKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const term = normalizeKey(search);
    if (!term) return;

    const exact = enriched.find((medicine) => normalizeKey(medicine.barcode) === term);
    if (exact) {
      addToCart(exact);
      return;
    }

    if (filtered.length === 1) {
      addToCart(filtered[0]);
      return;
    }

    if (filtered.length === 0) {
      toast.error("No medicine matches that barcode or search term.", "Not found");
      return;
    }

    toast.info("Multiple medicines match. Select one from the list.", "Choose a medicine");
  }

  function setItemQuantity(medicineId, value) {
    const quantity = Number(value);

    if (!Number.isInteger(quantity) || quantity < 1) return;

    setCart((previous) =>
      previous.map((item) => {
        if (item.medicineId !== medicineId) return item;

        if (quantity > item.availableStock) {
          toast.error(
            `Only ${item.availableStock} units of ${item.name} are available.`,
            "Stock limit reached"
          );
          return item;
        }

        return { ...item, quantity, total: roundMoney(quantity * item.unitPrice) };
      })
    );
  }

  function changeQuantity(medicineId, delta) {
    const item = cart.find((entry) => entry.medicineId === medicineId);
    if (!item) return;
    setItemQuantity(medicineId, item.quantity + delta);
  }

  function removeFromCart(medicineId) {
    setCart((previous) => previous.filter((item) => item.medicineId !== medicineId));
  }

  async function clearCart() {
    if (cart.length === 0) return;
    const accepted = await confirm({
      title: "Clear the current bill?",
      message: "All items in the cart will be removed. No sale has been recorded.",
      confirmLabel: "Clear cart",
      tone: "danger",
    });
    if (accepted) {
      setCart([]);
      setDiscount("0");
      setAmountPaid("");
      setAttempted(false);
      setNotes("");
    }
  }

  function selectCustomer(id) {
    if (!id) {
      setCustomer(EMPTY_CUSTOMER);
      return;
    }

    const match = customers.find((entry) => entry.id === id);
    if (match) {
      setCustomer({ id: match.id, name: match.name || "", phone: match.phone || "" });
    }
  }

  function updateCustomer(field, value) {
    setCustomer((previous) => ({ ...previous, id: field === "id" ? previous.id : "", [field]: value }));
  }

  function resetSale() {
    setLastSale(null);
    setCart([]);
    setCustomer(EMPTY_CUSTOMER);
    setDiscount("0");
    setPaymentMethod("Cash");
    setAmountPaid("");
    setAttempted(false);
    setNotes("");
    setSearch("");
    setError("");
  }

  async function completeSale() {
    if (checkoutLock.current) return;
    setError("");

    if (cart.length === 0) {
      setError("Add at least one medicine to the cart before completing the sale.");
      return;
    }

    setAttempted(true);

    if (hasDiscountInput && !isNonNegativeNumber(discount)) {
      setError("Enter a valid discount amount.");
      return;
    }

    if (discountNumber > subtotal) {
      setError(
        `Discount cannot be greater than the bill total (${formatMoney(subtotal, settings)}).`
      );
      return;
    }

    if (!cleanCustomerName) {
      setError("Customer name is required to complete the sale.");
      return;
    }

    if (!cleanCustomerPhone) {
      setError("Customer phone number is required to complete the sale.");
      return;
    }

    if (!isValidPhone(cleanCustomerPhone)) {
      setError("Enter a valid customer phone number (6–20 digits).");
      return;
    }

    if (!hasAmountPaidInput && grandTotal > 0) {
      setError("Enter the amount received from the customer.");
      return;
    }

    if (!Number.isFinite(amountPaidNumber) || amountPaidNumber < 0) {
      setError("Enter a valid amount received.");
      return;
    }

    if (roundMoney(amountPaidNumber) < grandTotal) {
      setError(
        `Amount received is short by ${formatMoney(
          roundMoney(grandTotal - amountPaidNumber),
          settings
        )}.`
      );
      return;
    }

    const paidAmount = hasAmountPaidInput ? roundMoney(amountPaidNumber) : 0;
    const changeAmount = roundMoney(Math.max(0, paidAmount - grandTotal));

    checkoutLock.current = true;
    setProcessing(true);

    try {
      const now = new Date();
      const saleId = crypto.randomUUID();
      const cashierName = user?.name || "Unknown user";

      let invoiceNumber = generateInvoiceNumber(settings.invoicePrefix);
      let attempt = 0;

      while (await db.sales.where("invoiceNumber").equals(invoiceNumber).first()) {
        attempt += 1;
        invoiceNumber = `${generateInvoiceNumber(settings.invoicePrefix)}-${attempt}`;

        if (attempt >= 50) {
          throw new Error(
            "Could not generate a unique invoice number. Reload the page and try again."
          );
        }
      }

      const sale = {
        id: saleId,
        invoiceNumber,
        customerId: customer.id || "",
        customerName: cleanCustomerName,
        customerPhone: cleanCustomerPhone,
        items: cart.map((item) => ({
          medicineId: item.medicineId,
          name: item.name,
          barcode: item.barcode,
          batch: item.batch,
          expiry: item.expiry,
          unitPrice: Number(item.unitPrice),
          costPrice: Number(item.costPrice || 0),
          quantity: Number(item.quantity),
          total: roundMoney(Number(item.unitPrice) * Number(item.quantity)),
        })),
        totalItems,
        subtotal,
        discount: roundMoney(discountValue),
        grandTotal,
        amountPaid: paidAmount,
        changeGiven: changeAmount,
        paymentMethod,
        notes: normalizeText(notes),
        status: "completed",
        createdAt: now.toISOString(),
        cashier: { id: user?.id || "", name: cashierName },
        cashierName,
        costRecorded: true,
      };

      await db.transaction("rw", db.medicines, db.sales, db.customers, async () => {
        for (const item of cart) {
          const medicine = await db.medicines.get(item.medicineId);

          if (!medicine) {
            throw new Error(`${item.name} no longer exists in inventory. Reload and try again.`);
          }

          const expiry = expiryInfo(medicine.expiry, warningDays);
          if (expiry.status === "expired") {
            throw new Error(`${item.name} is now expired and cannot be sold.`);
          }

          const currentStock = Number(medicine.quantity) || 0;

          if (item.quantity > currentStock) {
            throw new Error(
              `Insufficient stock for ${item.name}. Available now: ${currentStock}.`
            );
          }

          await db.medicines.update(item.medicineId, {
            quantity: currentStock - item.quantity,
            updatedAt: new Date().toISOString(),
          });
        }

        const duplicateCheck = await db.sales.where("invoiceNumber").equals(invoiceNumber).first();
        if (duplicateCheck) {
          throw new Error("This invoice number already exists. Please try again.");
        }

        let customerId = customer.id;
        if (!customerId) {
          const existingCustomer = await db.customers.where("phone").equals(cleanCustomerPhone).first();

          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else {
            customerId = crypto.randomUUID();
            await db.customers.add({
              id: customerId,
              name: cleanCustomerName,
              phone: cleanCustomerPhone,
              email: "",
              address: "",
              createdAt: now.toISOString(),
              updatedAt: now.toISOString(),
            });
          }
        }

        await db.sales.add({
          ...sale,
          customerId: customerId || "",
        });
      });

      setLastSale({ ...sale, customerId: customer.id || "" });
      setCart([]);
      setCustomer(EMPTY_CUSTOMER);
      setDiscount("0");
      setPaymentMethod("Cash");
      setAmountPaid("");
      setAttempted(false);
      setNotes("");
      setSearch("");

      toast.success(
        `Invoice ${sale.invoiceNumber} saved and stock updated.`,
        "Sale completed"
      );

      await loadData();
    } catch (saleError) {
      console.error("Checkout failed:", saleError);
      setError(
        saleError?.message ||
          "The sale could not be completed. No stock changes were saved because the transaction was rolled back."
      );
      toast.error(
        saleError?.message || "The sale could not be completed. Please try again.",
        "Checkout failed"
      );
      await loadData();
    } finally {
      checkoutLock.current = false;
      setProcessing(false);
    }
  }

  function printLastSale() {
    if (!lastSale) return;
    const opened = printSaleInvoice(lastSale, settings, logo);
    if (!opened) {
      toast.error("Allow pop-ups in your browser to print the invoice.", "Print blocked");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading point of sale…" />
      </div>
    );
  }

  if (lastSale) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="SALE COMPLETED"
          title="Invoice saved successfully"
          subtitle={`${lastSale.invoiceNumber} · ${formatMoney(lastSale.grandTotal, settings)}`}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => navigate("/sales-history")}>
                <Receipt size={16} />
                Sales History
              </button>
              <button type="button" className="btn btn-primary" onClick={resetSale}>
                <Plus size={16} />
                New Sale
              </button>
            </>
          }
        />

        <div className="pos-success-banner">
          <CheckCircle2 size={22} />
          <div>
            <strong>Stock was deducted once and the invoice was saved.</strong>
            <p>
              {lastSale.totalItems} item{lastSale.totalItems === 1 ? "" : "s"} ·{" "}
              {lastSale.paymentMethod} · Served by {lastSale.cashierName}
            </p>
          </div>
        </div>

        <div className="pos-success-grid">
          <section className="card pos-receipt-card">
            <InvoiceView sale={lastSale} settings={settings} logo={logo} />
          </section>

          <aside className="card pos-success-side">
            <h2>What happens next</h2>
            <ul className="plain-list">
              <li>Print or save the customer receipt.</li>
              <li>The sale is recorded in Sales History and Reports.</li>
              <li>Profit uses the purchase cost captured at checkout.</li>
              <li>You can cancel the sale from Sales History if needed.</li>
            </ul>

            <div className="pos-success-actions">
              <button type="button" className="btn btn-primary btn-block" onClick={printLastSale}>
                <Printer size={16} />
                Print Receipt
              </button>
              <button type="button" className="btn btn-secondary btn-block" onClick={resetSale}>
                Start New Sale
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="page pos-page">
      <PageHeader
        eyebrow="POINT OF SALE"
        title="New Sale"
        subtitle={`${todayISO()} · Search or scan a barcode, then complete the bill.`}
        actions={
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate("/sales-history")}
          >
            <Receipt size={16} />
            Sales History
          </button>
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-4 pos-stat-strip">
        <StatTile
          icon={ShoppingCart}
          tone="blue"
          label="Items in Bill"
          value={String(totalItems)}
          hint={`${cart.length} medicine line${cart.length === 1 ? "" : "s"}`}
        />
        <StatTile
          icon={Receipt}
          tone="indigo"
          label="Subtotal"
          value={formatMoney(subtotal, settings)}
          hint="Before discount"
        />
        <StatTile
          icon={Wallet}
          tone="green"
          label="Amount Due"
          value={formatMoney(grandTotal, settings)}
          hint={discountValue > 0 ? `Discount ${formatMoney(discountValue, settings)}` : "No discount"}
        />
        <StatTile
          icon={AlertTriangle}
          tone="amber"
          label="Low Stock Watch"
          value={String(enriched.filter((item) => item.__stock.status === "low").length)}
          hint={`At or below ${lowLimit} units`}
        />
      </div>

      <div className="pos-layout">
        <section className="card pos-products">
          <div className="card-head">
            <div>
              <h2>Medicine Catalog</h2>
              <p>Scan a barcode and press Enter, or search by name.</p>
            </div>
            <Badge tone="neutral">{filtered.length} shown</Badge>
          </div>

          <div className="pos-search-row">
            <div className="search-control pos-search-control">
              <Search size={17} />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search name, generic, batch or scan barcode…"
                autoFocus
              />
            </div>
            <span className="pos-scan-hint">
              <Barcode size={15} /> Enter adds exact barcode
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No medicines match"
              message="Check the search term or add medicines to inventory first."
            />
          ) : (
            <div className="pos-medicine-grid">
              {filtered.map((medicine) => {
                const stock = Number(medicine.quantity) || 0;
                const expired = medicine.__expiry.status === "expired";
                const inCart = cart.find((item) => item.medicineId === medicine.id);

                return (
                  <article
                    className={`pos-medicine-card ${expired ? "is-expired" : ""}`}
                    key={medicine.id}
                  >
                    <div className="pos-medicine-top">
                      <div>
                        <strong>{medicine.name}</strong>
                        <span>
                          {medicine.genericName || medicine.company || medicine.category || "—"}
                        </span>
                      </div>
                      <strong className="pos-medicine-price">
                        {formatMoney(medicine.salePrice, settings)}
                      </strong>
                    </div>

                    <div className="pos-medicine-meta">
                      <span>Batch {medicine.batch || "—"}</span>
                      <span>Exp {toDisplayDate(medicine.expiry)}</span>
                    </div>

                    <div className="pos-medicine-foot">
                      <div className="badge-stack">
                        <Badge
                          tone={expired ? "red" : stock <= 0 ? "red" : stock <= lowLimit ? "amber" : "green"}
                          dot
                        >
                          {expired
                            ? "Expired"
                            : stock <= 0
                              ? "Out of stock"
                              : `${stock} in stock`}
                        </Badge>
                        {inCart && <Badge tone="blue">{inCart.quantity} in bill</Badge>}
                      </div>

                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={stock <= 0 || expired}
                        onClick={() => addToCart(medicine)}
                      >
                        <Plus size={14} />
                        Add
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="card pos-cart">
          <div className="card-head">
            <div>
              <h2>Current Bill</h2>
              <p>{totalItems} unit{totalItems === 1 ? "" : "s"} across {cart.length} line{cart.length === 1 ? "" : "s"}</p>
            </div>
            {cart.length > 0 && (
              <button type="button" className="link-button" onClick={clearCart}>
                Clear
              </button>
            )}
          </div>

          <div className="pos-cart-items">
            {cart.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="Cart is empty"
                message="Search or scan a medicine to start a bill."
              />
            ) : (
              cart.map((item) => (
                <div className="pos-cart-line" key={item.medicineId}>
                  <div className="pos-cart-line-info">
                    <strong>{item.name}</strong>
                    <span>
                      {formatMoney(item.unitPrice, settings)} each · Batch {item.batch || "—"}
                    </span>
                  </div>

                  <div className="qty-control">
                    <button
                      type="button"
                      onClick={() => changeQuantity(item.medicineId, -1)}
                      disabled={item.quantity <= 1}
                      aria-label={`Decrease quantity for ${item.name}`}
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min="1"
                      max={item.availableStock}
                      value={item.quantity}
                      onChange={(event) => setItemQuantity(item.medicineId, event.target.value)}
                      aria-label={`Quantity for ${item.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => changeQuantity(item.medicineId, 1)}
                      disabled={item.quantity >= item.availableStock}
                      aria-label={`Increase quantity for ${item.name}`}
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <strong className="pos-cart-line-total">
                    {formatMoney(item.unitPrice * item.quantity, settings)}
                  </strong>

                  <button
                    type="button"
                    className="btn-icon btn-icon-danger"
                    onClick={() => removeFromCart(item.medicineId)}
                    aria-label={`Remove ${item.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="pos-customer">
            <div className="pos-customer-head">
              <UserRound size={16} />
              <strong>Customer</strong>
            </div>

            <Field label="Saved customer">
              <select value={customer.id} onChange={(event) => selectCustomer(event.target.value)}>
                <option value="">Select a saved customer</option>
                {customers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.phone ? ` · ${entry.phone}` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <div className="form-grid">
              <Field label="Customer name" required error={customerNameError}>
                <input
                  value={customer.name}
                  onChange={(event) => updateCustomer("name", event.target.value)}
                  placeholder="Customer full name"
                  autoComplete="name"
                />
              </Field>
              <Field label="Phone" required error={customerPhoneError}>
                <input
                  type="tel"
                  value={customer.phone}
                  onChange={(event) => updateCustomer("phone", event.target.value)}
                  placeholder="03XXXXXXXXX"
                  autoComplete="tel"
                />
              </Field>
            </div>
            <p className="field-note">
              Customer name and phone are required. If no saved customer is selected, a new
              customer record is created automatically at checkout.
            </p>
          </div>

          <div className="pos-bill">
            <div className="pos-bill-row">
              <span>Subtotal</span>
              <strong>{formatMoney(subtotal, settings)}</strong>
            </div>

            <div className="form-grid pos-bill-fields">
              <Field
                label={`Discount (${settings.currency || "PKR"})`}
                error={discountError}
                hint={subtotal > 0 ? `Maximum ${formatMoney(subtotal, settings)}` : undefined}
              >
                <input
                  type="number"
                  min="0"
                  max={subtotal > 0 ? subtotal : undefined}
                  step="0.01"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                  placeholder="0.00"
                  aria-invalid={Boolean(discountError)}
                />
              </Field>

              <Field label="Payment method">
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Notes">
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional note for this invoice"
              />
            </Field>

            {discountValue > 0 && (
              <div className="pos-bill-row">
                <span>Discount</span>
                <strong className="text-danger">− {formatMoney(discountValue, settings)}</strong>
              </div>
            )}

            <div className="pos-grand">
              <span>Grand Total</span>
              <strong>{formatMoney(grandTotal, settings)}</strong>
            </div>

            <div className="pos-payment">
              <div className="pos-payment-head">
                <Wallet size={16} />
                <strong>Payment</strong>
              </div>

              <Field
                label={`Amount received (${settings.currency || "PKR"})`}
                required
                error={paymentError}
                hint={
                  grandTotal > 0
                    ? `Bill total ${formatMoney(grandTotal, settings)}`
                    : "No payment is due on this bill."
                }
              >
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={amountPaid}
                  onChange={(event) => setAmountPaid(event.target.value)}
                  placeholder={grandTotal > 0 ? grandTotal.toFixed(2) : "0.00"}
                  aria-label="Amount received from customer"
                  aria-invalid={Boolean(paymentError)}
                />
              </Field>

              {grandTotal > 0 && (
                <button
                  type="button"
                  className="link-button pos-payment-exact"
                  onClick={() => setAmountPaid(grandTotal.toFixed(2))}
                >
                  Use exact amount ({formatMoney(grandTotal, settings)})
                </button>
              )}

              <div className="pos-payment-summary">
                <div className="pos-bill-row">
                  <span>Amount paid</span>
                  <strong>
                    {hasAmountPaidInput ? formatMoney(amountPaidValue, settings) : "—"}
                  </strong>
                </div>
                <div className="pos-bill-row">
                  <span>{changeDue > 0 ? "Change to return" : "Balance due"}</span>
                  <strong
                    className={
                      changeDue > 0 || balanceDue <= 0 ? "text-success" : "text-danger"
                    }
                  >
                    {formatMoney(changeDue > 0 ? changeDue : balanceDue, settings)}
                  </strong>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-lg btn-block"
              disabled={processing || cart.length === 0 || Boolean(discountError)}
              onClick={completeSale}
            >
              {processing ? "Saving sale…" : `Complete Sale · ${formatMoney(grandTotal, settings)}`}
            </button>
            <p className="pos-checkout-note">
              The sale and stock deduction are saved together in one database transaction.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
