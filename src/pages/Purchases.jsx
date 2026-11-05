import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  Package,
  Pencil,
  Plus,
  Printer,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useSettings, useLogo } from "../hooks/useSettings";
import { useUI } from "../context/UIContext";
import Modal from "../components/ui/Modal";
import {
  Badge,
  EmptyState,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchInput,
  StatTile,
} from "../components/ui/primitives";
import {
  formatInteger,
  formatMoney,
  isNonNegativeInteger,
  isNonNegativeNumber,
  normalizeText,
  roundMoney,
  saleItemCount,
  toDisplayDate,
  toDisplayDateTime,
  todayISO,
} from "../lib/format";
import { printPurchaseInvoice } from "../lib/print";

const EMPTY_DRAFT = { medicineId: "", quantity: "1", purchasePrice: "" };

function newPurchaseInvoice() {
  const stamp = todayISO().replace(/-/g, "");
  return `PUR-${stamp}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function emptyForm() {
  return {
    supplierId: "",
    purchaseDate: todayISO(),
    invoiceNumber: newPurchaseInvoice(),
    notes: "",
  };
}

export default function Purchases() {
  const settings = useSettings();
  const logo = useLogo();
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();

  const [purchases, setPurchases] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [cart, setCart] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [viewing, setViewing] = useState(null);

  const canManage = can("purchases.manage");
  const medicineMap = useMemo(
    () => new Map(medicines.map((medicine) => [medicine.id, medicine])),
    [medicines]
  );

  async function loadData() {
    try {
      setError("");
      const [purchaseRecords, medicineRecords, supplierRecords] = await Promise.all([
        db.purchases.toArray(),
        db.medicines.toArray(),
        db.suppliers.toArray(),
      ]);

      purchaseRecords.sort((a, b) => {
        const aDate = a.purchaseDate || String(a.createdAt || "").slice(0, 10);
        const bDate = b.purchaseDate || String(b.createdAt || "").slice(0, 10);
        return String(bDate).localeCompare(String(aDate)) ||
          String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });

      setPurchases(purchaseRecords);
      setMedicines(medicineRecords);
      setSuppliers(supplierRecords);
    } catch (loadError) {
      console.error("Purchase loading failed:", loadError);
      setError("Unable to load purchases. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body to avoid a synchronous cascading render.
    Promise.resolve().then(loadData);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return purchases.filter((purchase) => {
      const purchaseDate = purchase.purchaseDate || String(purchase.createdAt || "").slice(0, 10);
      const matchesSearch =
        !term ||
        [purchase.invoiceNumber, purchase.supplierName, purchase.notes].some((value) =>
          String(value || "").toLowerCase().includes(term)
        );
      const matchesSupplier =
        supplierFilter === "all" || purchase.supplierId === supplierFilter;
      const matchesStart = !startDate || purchaseDate >= startDate;
      const matchesEnd = !endDate || purchaseDate <= endDate;

      return matchesSearch && matchesSupplier && matchesStart && matchesEnd;
    });
  }, [purchases, search, supplierFilter, startDate, endDate]);

  const stats = useMemo(() => {
    const completed = filtered.filter((purchase) => purchase.status !== "cancelled");
    return {
      count: filtered.length,
      items: completed.reduce((total, purchase) => total + saleItemCount(purchase), 0),
      value: completed.reduce((total, purchase) => total + Number(purchase.grandTotal || 0), 0),
      suppliers: new Set(completed.map((purchase) => purchase.supplierId).filter(Boolean)).size,
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const cartTotal = useMemo(
    () =>
      roundMoney(
        cart.reduce(
          (total, item) => total + Number(item.purchasePrice) * Number(item.quantity),
          0
        )
      ),
    [cart]
  );

  function resetFilters() {
    setSearch("");
    setSupplierFilter("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setCart([]);
    setDraft(EMPTY_DRAFT);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(purchase) {
    setEditing(purchase);
    setForm({
      supplierId: purchase.supplierId || "",
      purchaseDate: purchase.purchaseDate || String(purchase.createdAt || "").slice(0, 10) || todayISO(),
      invoiceNumber: purchase.invoiceNumber || newPurchaseInvoice(),
      notes: purchase.notes || "",
    });
    setCart(
      (Array.isArray(purchase.items) ? purchase.items : []).map((item) => ({
        medicineId: item.medicineId,
        name: item.name,
        barcode: item.barcode || "",
        batch: item.batch || "",
        quantity: Number(item.quantity) || 0,
        purchasePrice: Number(item.purchasePrice) || 0,
        total: roundMoney(Number(item.quantity || 0) * Number(item.purchasePrice || 0)),
      }))
    );
    setDraft(EMPTY_DRAFT);
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setCart([]);
    setDraft(EMPTY_DRAFT);
    setFormError("");
  }

  function updateForm(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function selectDraftMedicine(medicineId) {
    const medicine = medicineMap.get(medicineId);
    setDraft({
      medicineId,
      quantity: "1",
      purchasePrice:
        medicine?.purchasePrice !== undefined ? String(medicine.purchasePrice) : "",
    });
  }

  function addDraftItem() {
    setFormError("");
    const medicine = medicineMap.get(draft.medicineId);
    const quantity = Number(draft.quantity);
    const price = Number(draft.purchasePrice);

    if (!medicine) {
      setFormError("Select a medicine to add.");
      return;
    }

    if (!isNonNegativeInteger(quantity) || quantity <= 0) {
      setFormError("Quantity must be a whole number greater than zero.");
      return;
    }

    if (!isNonNegativeNumber(price)) {
      setFormError("Purchase price must be a valid non-negative number.");
      return;
    }

    setCart((previous) => {
      const existing = previous.find((item) => item.medicineId === medicine.id);

      if (existing) {
        const nextQuantity = existing.quantity + quantity;
        return previous.map((item) =>
          item.medicineId === medicine.id
            ? {
                ...item,
                quantity: nextQuantity,
                purchasePrice: price,
                total: roundMoney(nextQuantity * price),
              }
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
          quantity,
          purchasePrice: price,
          total: roundMoney(quantity * price),
        },
      ];
    });

    setDraft(EMPTY_DRAFT);
  }

  function updateCartItem(medicineId, field, value) {
    if (field === "quantity") {
      const quantity = Number(value);
      if (!isNonNegativeInteger(quantity) || quantity <= 0) return;
      setCart((previous) =>
        previous.map((item) =>
          item.medicineId === medicineId
            ? { ...item, quantity, total: roundMoney(quantity * item.purchasePrice) }
            : item
        )
      );
      return;
    }

    const price = Number(value);
    if (!isNonNegativeNumber(price)) return;
    setCart((previous) =>
      previous.map((item) =>
        item.medicineId === medicineId
          ? { ...item, purchasePrice: price, total: roundMoney(item.quantity * price) }
          : item
      )
    );
  }

  function removeCartItem(medicineId) {
    setCart((previous) => previous.filter((item) => item.medicineId !== medicineId));
  }

  function buildStockDelta(items) {
    const map = new Map();
    items.forEach((item) => {
      map.set(item.medicineId, (map.get(item.medicineId) || 0) + Number(item.quantity || 0));
    });
    return map;
  }

  async function savePurchase(event) {
    event.preventDefault();
    setFormError("");

    if (!form.supplierId) {
      setFormError("Select a supplier for this purchase.");
      return;
    }

    if (!form.purchaseDate) {
      setFormError("Select a purchase date.");
      return;
    }

    if (!normalizeText(form.invoiceNumber)) {
      setFormError("Enter a unique invoice number.");
      return;
    }

    if (cart.length === 0) {
      setFormError("Add at least one medicine to the purchase.");
      return;
    }

    const supplier = suppliers.find((entry) => entry.id === form.supplierId);
    if (!supplier) {
      setFormError("The selected supplier no longer exists.");
      return;
    }

    const duplicate = purchases.find(
      (purchase) =>
        purchase.id !== editing?.id &&
        String(purchase.invoiceNumber || "").toLowerCase() ===
          normalizeText(form.invoiceNumber).toLowerCase()
    );

    if (duplicate) {
      setFormError("That invoice number already exists. Enter a different invoice number.");
      return;
    }

    setSaving(true);

    try {
      const items = cart.map((item) => ({
        medicineId: item.medicineId,
        name: item.name,
        barcode: item.barcode || "",
        batch: item.batch || "",
        quantity: Number(item.quantity),
        purchasePrice: Number(item.purchasePrice),
        total: roundMoney(Number(item.quantity) * Number(item.purchasePrice)),
      }));

      const purchaseRecord = {
        id: editing?.id || crypto.randomUUID(),
        invoiceNumber: normalizeText(form.invoiceNumber),
        supplierId: supplier.id,
        supplierName: supplier.name,
        supplierPhone: supplier.phone || "",
        purchaseDate: form.purchaseDate,
        createdAt: editing?.createdAt || new Date(`${form.purchaseDate}T12:00:00`).toISOString(),
        updatedAt: new Date().toISOString(),
        notes: normalizeText(form.notes),
        items,
        subtotal: cartTotal,
        grandTotal: cartTotal,
        status: "completed",
      };

      await db.transaction("rw", db.medicines, db.purchases, async () => {
        const duplicateCheck = await db.purchases
          .where("invoiceNumber")
          .equals(purchaseRecord.invoiceNumber)
          .first();

        if (duplicateCheck && duplicateCheck.id !== editing?.id) {
          throw new Error("That invoice number already exists. Enter a different invoice number.");
        }

        if (editing) {
          const current = await db.purchases.get(editing.id);
          if (!current) throw new Error("This purchase no longer exists. Reload the page.");

          const oldDelta = buildStockDelta(Array.isArray(current.items) ? current.items : []);
          const newDelta = buildStockDelta(items);
          const ids = new Set([...oldDelta.keys(), ...newDelta.keys()]);

          for (const medicineId of ids) {
            const medicine = await db.medicines.get(medicineId);

            if (!medicine) {
              const label =
                items.find((item) => item.medicineId === medicineId)?.name ||
                current.items?.find((item) => item.medicineId === medicineId)?.name ||
                "a medicine";
              throw new Error(
                `${label} no longer exists in inventory. Remove it from the purchase or restore the medicine record first.`
              );
            }

            const delta =
              (newDelta.get(medicineId) || 0) - (oldDelta.get(medicineId) || 0);
            const currentStock = Number(medicine.quantity || 0);
            const nextStock = currentStock + delta;

            if (nextStock < 0) {
              throw new Error(
                `Cannot reduce ${medicine.name} by ${Math.abs(delta)} units because only ${currentStock} are in stock. The original stock may have been sold.`
              );
            }

            const updates = {
              quantity: nextStock,
              updatedAt: new Date().toISOString(),
            };

            const newItem = items.find((item) => item.medicineId === medicineId);
            if (newItem) updates.purchasePrice = newItem.purchasePrice;

            await db.medicines.update(medicineId, updates);
          }

          await db.purchases.put({
            ...purchaseRecord,
            createdBy: current.createdBy || user?.name || "",
            updatedBy: user?.name || "",
            revision: Number(current.revision || 0) + 1,
          });
        } else {
          for (const item of items) {
            const medicine = await db.medicines.get(item.medicineId);

            if (!medicine) {
              throw new Error(
                `${item.name} no longer exists in inventory. Reload the page and try again.`
              );
            }

            await db.medicines.update(item.medicineId, {
              quantity: Number(medicine.quantity || 0) + Number(item.quantity),
              purchasePrice: Number(item.purchasePrice),
              updatedAt: new Date().toISOString(),
            });
          }

          await db.purchases.add({
            ...purchaseRecord,
            createdBy: user?.name || "",
            updatedBy: "",
            revision: 0,
          });
        }
      });

      toast.success(
        editing
          ? "Purchase updated and stock reconciled for the difference."
          : "Purchase saved and stock added exactly once.",
        editing ? "Purchase updated" : "Purchase saved"
      );

      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm());
      setCart([]);
      setDraft(EMPTY_DRAFT);
      await loadData();
    } catch (saveError) {
      console.error("Purchase save failed:", saveError);
      setFormError(
        saveError?.message ||
          "Unable to save the purchase. No stock changes were applied because the transaction was rolled back."
      );
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(purchase) {
    if (!canManage) return;

    const accepted = await confirm({
      title: `Delete purchase ${purchase.invoiceNumber || ""}?`,
      message:
        "Deleting a purchase removes the invoice and reverses the stock it added. If that stock has already been sold, the delete is blocked. For corrections, use Edit instead.",
      confirmLabel: "Delete purchase",
      tone: "danger",
    });

    if (!accepted) return;

    try {
      await db.transaction("rw", db.medicines, db.purchases, async () => {
        const current = await db.purchases.get(purchase.id);
        if (!current) throw new Error("This purchase no longer exists.");

        for (const item of current.items || []) {
          const medicine = await db.medicines.get(item.medicineId);
          if (!medicine) continue;

          const nextStock = Number(medicine.quantity || 0) - Number(item.quantity || 0);
          if (nextStock < 0) {
            throw new Error(
              `Cannot delete this purchase: ${medicine.name} only has ${medicine.quantity} units left, but ${item.quantity} were purchased. Use Edit to correct the invoice instead.`
            );
          }

          await db.medicines.update(item.medicineId, {
            quantity: nextStock,
            updatedAt: new Date().toISOString(),
          });
        }

        await db.purchases.delete(purchase.id);
      });

      toast.success("Purchase deleted and stock reversed.", "Purchase deleted");
      await loadData();
    } catch (deleteError) {
      console.error("Purchase delete failed:", deleteError);
      toast.error(deleteError.message || "Unable to delete this purchase.", "Delete failed");
    }
  }

  function printPurchase(purchase) {
    const opened = printPurchaseInvoice(purchase, settings, logo);
    if (!opened) {
      toast.error("Allow pop-ups in your browser to print the invoice.", "Print blocked");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading purchases…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Purchases"
        subtitle="Record supplier invoices and keep stock additions accurate."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <Plus size={16} />
              New Purchase
            </button>
          )
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-4">
        <StatTile
          icon={ShoppingCart}
          tone="blue"
          label="Purchase Invoices"
          value={formatInteger(stats.count)}
          hint="Matching current filters"
        />
        <StatTile
          icon={Package}
          tone="indigo"
          label="Items Purchased"
          value={formatInteger(stats.items)}
          hint="Total units received"
        />
        <StatTile
          icon={Truck}
          tone="green"
          label="Purchase Value"
          value={formatMoney(stats.value, settings)}
          hint="Completed invoices"
        />
        <StatTile
          icon={Truck}
          tone="slate"
          label="Suppliers Used"
          value={formatInteger(stats.suppliers)}
          hint="In the filtered period"
        />
      </div>

      {!suppliers.length && (
        <div className="form-alert form-alert-warning">
          No suppliers exist yet. Add a supplier before creating a purchase.
        </div>
      )}

      <section className="card">
        <div className="toolbar">
          <SearchInput
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search invoice, supplier or notes…"
          />

          <div className="toolbar-filters">
            <Field label="Supplier">
              <select
                value={supplierFilter}
                onChange={(event) => {
                  setSupplierFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All suppliers</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="From">
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setPage(1);
                }}
              />
            </Field>

            <Field label="To">
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setPage(1);
                }}
              />
            </Field>

            <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={purchases.length === 0 ? "No purchases recorded" : "No matching purchases"}
            message={
              purchases.length === 0
                ? "Create a purchase to add stock from a supplier."
                : "Adjust the date range, supplier or search term."
            }
            action={
              purchases.length === 0 && canManage ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={openCreate}
                  disabled={!suppliers.length || !medicines.length}
                >
                  <Plus size={15} /> New Purchase
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
                  Clear filters
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Supplier</th>
                    <th>Purchase Date</th>
                    <th className="num">Items</th>
                    <th className="num">Total</th>
                    <th>Status</th>
                    <th>Recorded</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((purchase) => (
                    <tr key={purchase.id}>
                      <td>
                        <div className="cell-primary">
                          <strong>{purchase.invoiceNumber || "—"}</strong>
                          <span>
                            {purchase.revision
                              ? `Revised ${purchase.revision} time${purchase.revision === 1 ? "" : "s"}`
                              : "Original entry"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-primary">
                          <strong>{purchase.supplierName || "—"}</strong>
                          <span>{purchase.supplierPhone || "—"}</span>
                        </div>
                      </td>
                      <td>{toDisplayDate(purchase.purchaseDate || purchase.createdAt)}</td>
                      <td className="num">{formatInteger(saleItemCount(purchase))}</td>
                      <td className="num">
                        <strong>{formatMoney(purchase.grandTotal, settings)}</strong>
                      </td>
                      <td>
                        <Badge tone={purchase.status === "cancelled" ? "red" : "green"} dot>
                          {purchase.status === "cancelled" ? "Cancelled" : "Completed"}
                        </Badge>
                      </td>
                      <td>{toDisplayDateTime(purchase.createdAt)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn-icon"
                            title="View invoice"
                            onClick={() => setViewing(purchase)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn-icon"
                            title="Print invoice"
                            onClick={() => printPurchase(purchase)}
                          >
                            <Printer size={16} />
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Edit purchase"
                                onClick={() => openEdit(purchase)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon btn-icon-danger"
                                title="Delete purchase and reverse stock"
                                onClick={() => requestDelete(purchase)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={safePage}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </section>

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editing ? "Edit Purchase" : "New Purchase"}
        subtitle={
          editing
            ? "Changes are applied as a stock difference so stock is never added twice."
            : "Adding stock and saving the invoice happen in one transaction."
        }
        size="xl"
        closeDisabled={saving}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="purchase-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Update Purchase" : "Save Purchase"}
            </button>
          </>
        }
      >
        <form id="purchase-form" onSubmit={savePurchase} className="purchase-form">
          <div className="form-grid">
            <Field label="Supplier" required>
              <select
                value={form.supplierId}
                onChange={(event) => updateForm("supplierId", event.target.value)}
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Purchase Date" required>
              <input
                type="date"
                value={form.purchaseDate}
                max={todayISO()}
                onChange={(event) => updateForm("purchaseDate", event.target.value)}
              />
            </Field>

            <Field label="Invoice Number" required hint="Must be unique across all purchase invoices.">
              <input
                value={form.invoiceNumber}
                onChange={(event) => updateForm("invoiceNumber", event.target.value)}
              />
            </Field>

            <Field label="Notes" className="field-span-2">
              <input
                value={form.notes}
                onChange={(event) => updateForm("notes", event.target.value)}
                placeholder="Optional delivery or payment notes"
              />
            </Field>
          </div>

          <div className="purchase-section">
            <div className="purchase-section-head">
              <div>
                <h3>Add Medicines</h3>
                <p>Quantities are added to the selected inventory record.</p>
              </div>
              <Badge tone="neutral">{medicines.length} medicines</Badge>
            </div>

            <div className="purchase-item-draft">
              <Field label="Medicine">
                <select
                  value={draft.medicineId}
                  onChange={(event) => selectDraftMedicine(event.target.value)}
                >
                  <option value="">Select medicine</option>
                  {medicines.map((medicine) => (
                    <option key={medicine.id} value={medicine.id}>
                      {medicine.name}
                      {medicine.batch ? ` · ${medicine.batch}` : ""}
                      {medicine.barcode ? ` · ${medicine.barcode}` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Quantity">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={draft.quantity}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, quantity: event.target.value }))
                  }
                />
              </Field>

              <Field label="Purchase Price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.purchasePrice}
                  onChange={(event) =>
                    setDraft((previous) => ({ ...previous, purchasePrice: event.target.value }))
                  }
                  placeholder="0.00"
                />
              </Field>

              <button type="button" className="btn btn-secondary purchase-add-btn" onClick={addDraftItem}>
                <Plus size={16} />
                Add Item
              </button>
            </div>

            {cart.length === 0 ? (
              <p className="inline-empty">No medicines added yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table compact-table">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th className="num">Quantity</th>
                      <th className="num">Purchase Price</th>
                      <th className="num">Line Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.medicineId}>
                        <td>
                          <div className="cell-primary">
                            <strong>{item.name}</strong>
                            <span>Batch {item.batch || "—"}</span>
                          </div>
                        </td>
                        <td className="num">
                          <input
                            className="table-input"
                            type="number"
                            min="1"
                            step="1"
                            value={item.quantity}
                            onChange={(event) =>
                              updateCartItem(item.medicineId, "quantity", event.target.value)
                            }
                            aria-label={`Quantity for ${item.name}`}
                          />
                        </td>
                        <td className="num">
                          <input
                            className="table-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.purchasePrice}
                            onChange={(event) =>
                              updateCartItem(item.medicineId, "purchasePrice", event.target.value)
                            }
                            aria-label={`Purchase price for ${item.name}`}
                          />
                        </td>
                        <td className="num">
                          <strong>{formatMoney(item.total, settings)}</strong>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-icon btn-icon-danger"
                            onClick={() => removeCartItem(item.medicineId)}
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="purchase-total-row">
              <span>Grand Total</span>
              <strong>{formatMoney(cartTotal, settings)}</strong>
            </div>
          </div>

          {formError && <div className="form-alert form-alert-error">{formError}</div>}
        </form>
      </Modal>

      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.invoiceNumber || "Purchase Invoice"}
        subtitle={
          viewing
            ? `${viewing.supplierName || "—"} · ${toDisplayDate(viewing.purchaseDate || viewing.createdAt)}`
            : ""
        }
        size="lg"
        footer={
          viewing ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setViewing(null)}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={() => printPurchase(viewing)}>
                <Printer size={16} />
                Print Invoice
              </button>
            </>
          ) : null
        }
      >
        {viewing && (
          <div className="purchase-view">
            <div className="detail-grid">
              <div>
                <span>Supplier</span>
                <strong>{viewing.supplierName || "—"}</strong>
              </div>
              <div>
                <span>Supplier Phone</span>
                <strong>{viewing.supplierPhone || "—"}</strong>
              </div>
              <div>
                <span>Purchase Date</span>
                <strong>{toDisplayDate(viewing.purchaseDate || viewing.createdAt)}</strong>
              </div>
              <div>
                <span>Recorded</span>
                <strong>{toDisplayDateTime(viewing.createdAt)}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{viewing.status === "cancelled" ? "Cancelled" : "Completed"}</strong>
              </div>
              <div>
                <span>Entered By</span>
                <strong>{viewing.createdBy || "—"}</strong>
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Batch</th>
                    <th className="num">Qty</th>
                    <th className="num">Price</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.items || []).map((item, index) => (
                    <tr key={`${item.medicineId}-${index}`}>
                      <td>
                        <strong>{item.name}</strong>
                      </td>
                      <td>{item.batch || "—"}</td>
                      <td className="num">{item.quantity}</td>
                      <td className="num">{formatMoney(item.purchasePrice, settings)}</td>
                      <td className="num">{formatMoney(item.total, settings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="purchase-total-row">
              <span>Grand Total</span>
              <strong>{formatMoney(viewing.grandTotal, settings)}</strong>
            </div>

            {viewing.notes && <p className="invoice-note">{viewing.notes}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
