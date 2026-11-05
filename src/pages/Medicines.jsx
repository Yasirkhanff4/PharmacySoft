import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Download,
  Eye,
  Package,
  Pencil,
  Pill,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import { useUI } from "../context/UIContext";
import Modal from "../components/ui/Modal";
import {
  buildDemoTabletRecords,
  DEMO_TABLET_SET_LABEL,
  DEMO_TABLET_SOURCE,
  validateDemoTabletRecords,
} from "../lib/demoTablets";
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
  downloadCSV,
  expiryInfo,
  formatInteger,
  formatMoney,
  getStockStatus,
  isNonNegativeInteger,
  isNonNegativeNumber,
  normalizeKey,
  normalizeText,
  toDisplayDate,
  todayISO,
} from "../lib/format";
import { MEDICINE_CATEGORIES } from "../lib/constants";

const EMPTY_FORM = {
  name: "",
  genericName: "",
  category: "Tablet",
  company: "",
  supplierId: "",
  barcode: "",
  batch: "",
  expiry: "",
  purchasePrice: "",
  salePrice: "",
  quantity: "",
};

function sortMedicines(list, sort) {
  const copy = [...list];

  if (sort === "name-desc") return copy.sort((a, b) => String(b.name).localeCompare(String(a.name)));
  if (sort === "stock-asc") return copy.sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));
  if (sort === "stock-desc") return copy.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
  if (sort === "expiry-asc") return copy.sort((a, b) => String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")));
  if (sort === "value-desc") {
    return copy.sort(
      (a, b) =>
        Number(b.purchasePrice || 0) * Number(b.quantity || 0) -
        Number(a.purchasePrice || 0) * Number(a.quantity || 0)
    );
  }

  return copy.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export default function Medicines() {
  const settings = useSettings();
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();
  const location = useLocation();

  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [sort, setSort] = useState("name-asc");

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [details, setDetails] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ mode: "add", quantity: "", reason: "" });
  const [adjusting, setAdjusting] = useState(false);

  const [demoOpen, setDemoOpen] = useState(false);
  const [demoSupplierId, setDemoSupplierId] = useState("");
  const [demoConfirmed, setDemoConfirmed] = useState(false);
  const [demoImporting, setDemoImporting] = useState(false);
  const [demoCreatingSupplier, setDemoCreatingSupplier] = useState(false);
  const [demoResult, setDemoResult] = useState(null);

  const canManage = can("medicines.manage");
  const isAdmin = user?.role === "admin";
  const lowLimit = Number(settings.lowStockLimit) || 10;
  const warningDays = Number(settings.expiryWarningDays) || 30;

  async function loadMedicines() {
    try {
      setError("");
      const [medicineRecords, supplierRecords] = await Promise.all([
        db.medicines.toArray(),
        db.suppliers.toArray(),
      ]);
      setMedicines(medicineRecords);
      setSuppliers(supplierRecords);
    } catch (loadError) {
      console.error("Loading medicines failed:", loadError);
      setError("Unable to load medicines. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body to avoid a synchronous cascading render.
    Promise.resolve().then(loadMedicines);
  }, []);

  useEffect(() => {
    // Defer the navigation-driven state changes so they cannot trigger a
    // synchronous cascading render inside this effect.
    Promise.resolve().then(() => {
      if (location.state?.openAdd && canManage) {
        openAddForm();
      }
      if (location.state?.stockStatus) {
        setStockFilter(location.state.stockStatus);
      }
    });
    // Intentionally runs only for a new navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const categories = useMemo(() => {
    const set = new Set(MEDICINE_CATEGORIES);
    medicines.forEach((medicine) => {
      if (medicine.category) set.add(medicine.category);
    });
    return [...set].sort();
  }, [medicines]);

  const enriched = useMemo(
    () =>
      medicines.map((medicine) => {
        const expiry = expiryInfo(medicine.expiry, warningDays);
        const stock = getStockStatus(medicine.quantity, lowLimit);
        return { ...medicine, __expiry: expiry, __stock: stock };
      }),
    [medicines, lowLimit, warningDays]
  );

  const stats = useMemo(() => {
    const costValue = medicines.reduce(
      (total, medicine) =>
        total + Number(medicine.purchasePrice || 0) * Number(medicine.quantity || 0),
      0
    );
    const retailValue = medicines.reduce(
      (total, medicine) =>
        total + Number(medicine.salePrice || 0) * Number(medicine.quantity || 0),
      0
    );
    const low = enriched.filter(
      (medicine) => medicine.__stock.status === "low"
    ).length;
    const out = enriched.filter((medicine) => medicine.__stock.status === "out").length;
    const expired = enriched.filter((medicine) => medicine.__expiry.status === "expired").length;
    const expiring = enriched.filter((medicine) => medicine.__expiry.status === "expiring").length;

    return { costValue, retailValue, low, out, expired, expiring };
  }, [medicines, enriched]);

  const demoSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === demoSupplierId) || null,
    [suppliers, demoSupplierId]
  );

  const demoRecords = useMemo(
    () =>
      buildDemoTabletRecords({
        supplier: demoSupplier,
        createdBy: user?.name || "",
      }),
    [demoSupplier, user?.name]
  );

  const demoValidation = useMemo(
    () =>
      validateDemoTabletRecords({
        records: demoRecords,
        existingMedicines: medicines,
        supplier: demoSupplier,
      }),
    [demoRecords, medicines, demoSupplier]
  );

  const filtered = useMemo(() => {
    const term = normalizeKey(search);

    const list = enriched.filter((medicine) => {
      const matchesSearch =
        !term ||
        [medicine.name, medicine.genericName, medicine.barcode, medicine.batch, medicine.company]
          .some((value) => normalizeKey(value).includes(term));

      const matchesCategory =
        categoryFilter === "all" || (medicine.category || "Uncategorised") === categoryFilter;

      const matchesSupplier =
        supplierFilter === "all" || medicine.supplierId === supplierFilter;

      let matchesStock = true;

      if (stockFilter === "low") matchesStock = medicine.__stock.status === "low";
      else if (stockFilter === "out") matchesStock = medicine.__stock.status === "out";
      else if (stockFilter === "in") matchesStock = medicine.__stock.status === "in";
      else if (stockFilter === "expired") matchesStock = medicine.__expiry.status === "expired";
      else if (stockFilter === "expiring") matchesStock = medicine.__expiry.status === "expiring";

      return matchesSearch && matchesCategory && matchesSupplier && matchesStock;
    });

    return sortMedicines(list, sort);
  }, [enriched, search, categoryFilter, supplierFilter, stockFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetFilters() {
    setSearch("");
    setCategoryFilter("all");
    setStockFilter("all");
    setSupplierFilter("all");
    setSort("name-asc");
    setPage(1);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, expiry: "" });
    setFormError("");
    setFormOpen(true);
  }

  function openEditForm(medicine) {
    setEditingId(medicine.id);
    setForm({
      name: medicine.name || "",
      genericName: medicine.genericName || "",
      category: medicine.category || "Tablet",
      company: medicine.company || medicine.manufacturer || "",
      supplierId: medicine.supplierId || "",
      barcode: medicine.barcode || "",
      batch: medicine.batch || "",
      expiry: medicine.expiry || "",
      purchasePrice: String(medicine.purchasePrice ?? ""),
      salePrice: String(medicine.salePrice ?? ""),
      quantity: String(medicine.quantity ?? ""),
    });
    setFormError("");
    setFormOpen(true);
  }

  function updateForm(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function saveMedicine(event) {
    event.preventDefault();
    setFormError("");

    const name = normalizeText(form.name);
    const batch = normalizeText(form.batch);
    const expiry = form.expiry;
    const purchasePrice = Number(form.purchasePrice);
    const salePrice = Number(form.salePrice);
    const quantity = Number(form.quantity);

    if (!name) return setFormError("Medicine name is required.");
    if (!batch) return setFormError("Batch number is required.");
    if (!expiry) return setFormError("Expiry date is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(new Date(`${expiry}T12:00:00`).getTime())) {
      return setFormError("Please enter a valid expiry date.");
    }
    if (!isNonNegativeNumber(purchasePrice)) {
      return setFormError("Purchase price must be a valid non-negative number.");
    }
    if (!isNonNegativeNumber(salePrice)) {
      return setFormError("Sale price must be a valid non-negative number.");
    }
    if (!isNonNegativeInteger(quantity)) {
      return setFormError("Quantity must be a whole number of zero or more.");
    }

    const duplicate = medicines.find(
      (medicine) =>
        medicine.id !== editingId &&
        normalizeKey(medicine.name) === normalizeKey(name) &&
        normalizeKey(medicine.batch) === normalizeKey(batch)
    );

    if (duplicate) {
      return setFormError(
        `A medicine with the same name and batch already exists (${duplicate.name} · batch ${duplicate.batch}).`
      );
    }

    const supplier = suppliers.find((item) => item.id === form.supplierId);

    const data = {
      name,
      genericName: normalizeText(form.genericName),
      category: normalizeText(form.category) || "Other",
      company: normalizeText(form.company),
      supplierId: supplier?.id || "",
      supplierName: supplier?.name || "",
      barcode: normalizeText(form.barcode),
      batch,
      expiry,
      purchasePrice,
      salePrice,
      quantity,
      updatedAt: new Date().toISOString(),
      updatedBy: user?.name || "",
    };

    setSaving(true);

    try {
      if (editingId) {
        await db.medicines.update(editingId, data);
        toast.success(`${name} was updated.`, "Medicine updated");
      } else {
        await db.medicines.add({
          id: crypto.randomUUID(),
          ...data,
          createdAt: new Date().toISOString(),
          createdBy: user?.name || "",
        });
        toast.success(`${name} was added to inventory.`, "Medicine added");
      }

      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadMedicines();
    } catch (saveError) {
      console.error("Medicine save failed:", saveError);
      setFormError(saveError.message || "Unable to save medicine.");
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(medicine) {
    const [sales, purchases] = await Promise.all([
      db.sales.toArray(),
      db.purchases.toArray(),
    ]);

    const salesCount = sales.filter((sale) =>
      (sale.items || []).some((item) => item.medicineId === medicine.id)
    ).length;

    const purchaseCount = purchases.filter((purchase) =>
      (purchase.items || []).some((item) => item.medicineId === medicine.id)
    ).length;

    const historyNote =
      salesCount || purchaseCount
        ? `\n\nThis medicine appears in ${salesCount} sale invoice(s) and ${purchaseCount} purchase invoice(s). Those financial records will be preserved, but stock and profit history for this item will no longer link to a medicine record.`
        : "";

    const accepted = await confirm({
      title: `Delete ${medicine.name}?`,
      message: `This removes batch ${medicine.batch || "—"} from inventory permanently.${historyNote}`,
      confirmLabel: "Delete medicine",
      tone: "danger",
    });

    if (!accepted) return;

    setDeleteTarget(medicine);
    setDeleting(true);

    try {
      await db.medicines.delete(medicine.id);
      toast.success(`${medicine.name} was deleted from inventory.`, "Medicine deleted");
      await loadMedicines();
    } catch (deleteError) {
      console.error("Delete error:", deleteError);
      toast.error(deleteError.message || "Unable to delete medicine.", "Delete failed");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  function openAdjust(medicine) {
    setAdjustTarget(medicine);
    setAdjustForm({ mode: "add", quantity: "", reason: "" });
  }

  async function applyAdjustment(event) {
    event.preventDefault();
    if (!adjustTarget) return;

    const amount = Number(adjustForm.quantity);

    if (!isNonNegativeInteger(amount) || amount <= 0) {
      toast.error("Enter a whole number greater than zero.", "Invalid quantity");
      return;
    }

    const current = Number(adjustTarget.quantity || 0);
    let nextQuantity = current;

    if (adjustForm.mode === "add") nextQuantity = current + amount;
    if (adjustForm.mode === "remove") nextQuantity = current - amount;
    if (adjustForm.mode === "set") nextQuantity = amount;

    if (nextQuantity < 0) {
      toast.error(
        `This adjustment would make stock negative. Current stock is ${current}.`,
        "Adjustment not allowed"
      );
      return;
    }

    setAdjusting(true);

    try {
      await db.medicines.update(adjustTarget.id, {
        quantity: nextQuantity,
        updatedAt: new Date().toISOString(),
        lastStockAdjustment: {
          at: new Date().toISOString(),
          by: user?.name || "Unknown",
          from: current,
          to: nextQuantity,
          mode: adjustForm.mode,
          reason: normalizeText(adjustForm.reason),
        },
      });

      toast.success(
        `${adjustTarget.name} stock changed from ${current} to ${nextQuantity}.`,
        "Stock adjusted"
      );
      setAdjustTarget(null);
      await loadMedicines();
    } catch (adjustError) {
      console.error("Stock adjustment failed:", adjustError);
      toast.error(adjustError.message || "Unable to adjust stock.", "Adjustment failed");
    } finally {
      setAdjusting(false);
    }
  }

  function openDemoImport() {
    if (user?.role !== "admin") {
      toast.error("Only an administrator can import demonstration inventory.", "Permission denied");
      return;
    }

    setDemoSupplierId((current) =>
      suppliers.some((supplier) => supplier.id === current) ? current : suppliers[0]?.id || ""
    );
    setDemoConfirmed(false);
    setDemoResult(null);
    setDemoOpen(true);
  }

  async function createDemoSupplier() {
    if (user?.role !== "admin") {
      toast.error("Only an administrator can create the demo supplier.", "Permission denied");
      return;
    }

    setDemoCreatingSupplier(true);

    try {
      const name = "Demo Supplier (Demo Records Only)";
      const existing = suppliers.find((supplier) => supplier.name === name);

      if (existing) {
        setDemoSupplierId(existing.id);
        setDemoConfirmed(false);
        toast.info("Using the existing demo supplier.", "Demo supplier selected");
        return;
      }

      const now = new Date().toISOString();
      const supplier = {
        id: crypto.randomUUID(),
        name,
        phone: "",
        email: "",
        address: "Demo address — fictional supplier for demonstration inventory",
        isDemo: true,
        createdAt: now,
        createdBy: user?.name || "",
        updatedAt: now,
        updatedBy: user?.name || "",
      };

      await db.suppliers.add(supplier);
      await loadMedicines();
      setDemoSupplierId(supplier.id);
      setDemoConfirmed(false);
      toast.success("Demo supplier created and selected.", "Demo supplier ready");
    } catch (createError) {
      console.error("Demo supplier creation failed:", createError);
      toast.error(
        createError?.message || "The demo supplier could not be created.",
        "Supplier creation failed"
      );
    } finally {
      setDemoCreatingSupplier(false);
    }
  }

  async function importDemoTablets() {
    if (user?.role !== "admin") {
      toast.error("Only an administrator can import demonstration inventory.", "Permission denied");
      return;
    }

    if (!demoConfirmed) {
      toast.error(
        "Confirm that you understand these are demonstration records before importing.",
        "Confirmation required"
      );
      return;
    }

    if (!demoValidation.valid || demoValidation.newRecords.length === 0) {
      toast.error(
        "Resolve the validation issues or check whether the records already exist.",
        "Import blocked"
      );
      return;
    }

    const accepted = await confirm({
      title: `Import ${demoValidation.newRecords.length} demo tablet records?`,
      message: `This adds ${demoValidation.newRecords.length} fictional tablet records linked to ${
        demoSupplier?.name || "the selected supplier"
      }. Existing medicines will not be modified. These records are demonstration data only and must not be used for dispensing or real transactions.`,
      confirmLabel: `Import ${demoValidation.newRecords.length} records`,
      tone: "primary",
    });

    if (!accepted) return;

    setDemoImporting(true);
    setDemoResult(null);

    try {
      const [freshMedicines, freshSuppliers] = await Promise.all([
        db.medicines.toArray(),
        db.suppliers.toArray(),
      ]);

      const supplier = freshSuppliers.find((item) => item.id === demoSupplierId) || null;
      const records = buildDemoTabletRecords({
        supplier,
        createdBy: user?.name || "",
      });
      const validation = validateDemoTabletRecords({
        records,
        existingMedicines: freshMedicines,
        supplier,
      });

      if (!validation.valid) {
        setDemoConfirmed(false);
        toast.error(
          "The inventory changed while this preview was open. Review the validation errors and try again.",
          "Import blocked"
        );
        await loadMedicines();
        return;
      }

      const toInsert = validation.newRecords;

      if (toInsert.length === 0) {
        setDemoResult({
          inserted: 0,
          skipped: records.length,
          supplierName: supplier?.name || "",
        });
        toast.info("All 50 demo tablet records are already in inventory.", "Nothing to import");
        await loadMedicines();
        return;
      }

      await db.transaction("rw", db.medicines, async () => {
        await db.medicines.bulkAdd(toInsert);
      });

      const skipped = records.length - toInsert.length;
      setDemoResult({
        inserted: toInsert.length,
        skipped,
        supplierName: supplier?.name || "",
      });
      setDemoConfirmed(false);
      toast.success(
        `${toInsert.length} demo tablet record${toInsert.length === 1 ? "" : "s"} added.${
          skipped ? ` ${skipped} already existed and were skipped.` : ""
        }`,
        "Demo import complete"
      );
      await loadMedicines();
    } catch (importError) {
      console.error("Demo tablet import failed:", importError);
      toast.error(
        importError?.message ||
          "The demo import could not be completed. No partial import was saved.",
        "Import failed"
      );
      await loadMedicines();
    } finally {
      setDemoImporting(false);
    }
  }

  function exportCSV() {
    downloadCSV(
      `Medicines-${todayISO()}.csv`,
      [
        "Name",
        "Generic Name",
        "Category",
        "Company",
        "Supplier",
        "Barcode",
        "Batch",
        "Expiry",
        "Purchase Price",
        "Sale Price",
        "Quantity",
        "Stock Status",
        "Expiry Status",
      ],
      filtered.map((medicine) => [
        medicine.name,
        medicine.genericName,
        medicine.category,
        medicine.company,
        medicine.supplierName,
        medicine.barcode,
        medicine.batch,
        medicine.expiry,
        medicine.purchasePrice,
        medicine.salePrice,
        medicine.quantity,
        medicine.__stock.label,
        medicine.__expiry.status,
      ])
    );
    toast.success("Medicine inventory exported as CSV.", "Export complete");
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading medicine inventory…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="INVENTORY"
        title="Medicines"
        subtitle="Manage batches, prices, stock levels and expiry dates."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={exportCSV}>
              <Download size={16} />
              Export CSV
            </button>
            {isAdmin && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={openDemoImport}
                title="Preview and import 50 clearly labelled demo tablet records"
              >
                <Sparkles size={16} />
                Import Demo Tablets
              </button>
            )}
            {canManage && (
              <button type="button" className="btn btn-primary" onClick={openAddForm}>
                <Plus size={16} />
                Add Medicine
              </button>
            )}
          </>
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-3">
        <StatTile
          icon={Pill}
          tone="blue"
          label="Total Medicines"
          value={formatInteger(medicines.length)}
          hint={`${categories.length} categories`}
        />
        <StatTile
          icon={Package}
          tone="green"
          label="Stock Cost Value"
          value={formatMoney(stats.costValue, settings)}
          hint={`Retail ${formatMoney(stats.retailValue, settings)}`}
        />
        <StatTile
          icon={AlertTriangle}
          tone="amber"
          label="Low / Out of Stock"
          value={`${stats.low} / ${stats.out}`}
          hint={`Low threshold: ${lowLimit} units`}
        />
        <StatTile
          icon={CalendarX}
          tone="red"
          label="Expired"
          value={formatInteger(stats.expired)}
          hint="Must not be sold"
        />
        <StatTile
          icon={CalendarClock}
          tone="orange"
          label="Expiring Soon"
          value={formatInteger(stats.expiring)}
          hint={`Within ${warningDays} days`}
        />
        <StatTile
          icon={Package}
          tone="slate"
          label="Total Units"
          value={formatInteger(
            medicines.reduce((total, medicine) => total + Number(medicine.quantity || 0), 0)
          )}
          hint="Across all batches"
        />
      </div>

      <section className="card">
        <div className="toolbar">
          <SearchInput
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search name, generic, barcode, batch or company…"
          />

          <div className="toolbar-filters">
            <select
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by category"
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <select
              value={supplierFilter}
              onChange={(event) => {
                setSupplierFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by supplier"
            >
              <option value="all">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>

            <select
              value={stockFilter}
              onChange={(event) => {
                setStockFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by stock status"
            >
              <option value="all">All stock statuses</option>
              <option value="in">In stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="expired">Expired</option>
              <option value="expiring">Expiring soon</option>
            </select>

            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort medicines"
            >
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="stock-asc">Stock low to high</option>
              <option value="stock-desc">Stock high to low</option>
              <option value="expiry-asc">Expiry soonest</option>
              <option value="value-desc">Highest stock value</option>
            </select>

            <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
              <SlidersHorizontal size={15} />
              Reset
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Pill}
            title={medicines.length === 0 ? "No medicines in inventory" : "No matching medicines"}
            message={
              medicines.length === 0
                ? "Add your first medicine to start managing stock."
                : "Try adjusting the search term or filters."
            }
            action={
              medicines.length === 0 && canManage ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openAddForm}>
                  <Plus size={15} /> Add Medicine
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
                    <th>Medicine</th>
                    <th>Category</th>
                    <th>Batch / Expiry</th>
                    <th>Supplier</th>
                    <th className="num">Purchase</th>
                    <th className="num">Sale</th>
                    <th className="num">Stock</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((medicine) => (
                    <tr key={medicine.id}>
                      <td>
                        <div className="cell-primary">
                          <strong className="medicine-name">
                            {medicine.name}
                            {medicine.isDemo && <Badge tone="indigo">DEMO</Badge>}
                          </strong>
                          <span>
                            {medicine.genericName || medicine.company || "—"}
                            {medicine.barcode ? ` · ${medicine.barcode}` : ""}
                          </span>
                        </div>
                      </td>
                      <td>{medicine.category || "—"}</td>
                      <td>
                        <div className="cell-primary">
                          <strong>{medicine.batch || "—"}</strong>
                          <span>{toDisplayDate(medicine.expiry)}</span>
                        </div>
                      </td>
                      <td>{medicine.supplierName || "—"}</td>
                      <td className="num">{formatMoney(medicine.purchasePrice, settings)}</td>
                      <td className="num">
                        <strong>{formatMoney(medicine.salePrice, settings)}</strong>
                      </td>
                      <td className="num">
                        <strong>{formatInteger(medicine.quantity)}</strong>
                      </td>
                      <td>
                        <div className="badge-stack">
                          <Badge
                            tone={
                              medicine.__stock.status === "out"
                                ? "red"
                                : medicine.__stock.status === "low"
                                  ? "amber"
                                  : "green"
                            }
                            dot
                          >
                            {medicine.__stock.status === "out"
                              ? "Out"
                              : medicine.__stock.status === "low"
                                ? "Low"
                                : "In stock"}
                          </Badge>

                          {medicine.__expiry.status === "expired" && (
                            <Badge tone="red">Expired</Badge>
                          )}
                          {medicine.__expiry.status === "expiring" && (
                            <Badge tone="orange">{medicine.__expiry.label}</Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn-icon"
                            title="View details"
                            onClick={() => setDetails(medicine)}
                          >
                            <Eye size={16} />
                          </button>

                          {canManage && (
                            <>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Adjust stock"
                                onClick={() => openAdjust(medicine)}
                              >
                                <SlidersHorizontal size={16} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Edit medicine"
                                onClick={() => openEditForm(medicine)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon btn-icon-danger"
                                title="Delete medicine"
                                onClick={() => requestDelete(medicine)}
                                disabled={deleting && deleteTarget?.id === medicine.id}
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
        onClose={() => {
          if (!saving) setFormOpen(false);
        }}
        title={editingId ? "Edit Medicine" : "Add New Medicine"}
        subtitle="Batch-level inventory details. Required fields are marked with an asterisk."
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="medicine-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : editingId ? "Update Medicine" : "Save Medicine"}
            </button>
          </>
        }
      >
        <form id="medicine-form" onSubmit={saveMedicine} className="form-grid">
          <Field label="Medicine Name" required className="field-span-2">
            <input
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="e.g. Paracetamol 500mg"
              autoFocus
            />
          </Field>

          <Field label="Generic Name">
            <input
              value={form.genericName}
              onChange={(event) => updateForm("genericName", event.target.value)}
              placeholder="e.g. Paracetamol"
            />
          </Field>

          <Field label="Category">
            <input
              list="medicine-category-options"
              value={form.category}
              onChange={(event) => updateForm("category", event.target.value)}
              placeholder="Select or type a category"
            />
            <datalist id="medicine-category-options">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </Field>

          <Field label="Company / Manufacturer">
            <input
              value={form.company}
              onChange={(event) => updateForm("company", event.target.value)}
              placeholder="e.g. GSK"
            />
          </Field>

          <Field label="Supplier">
            <select
              value={form.supplierId}
              onChange={(event) => updateForm("supplierId", event.target.value)}
            >
              <option value="">No supplier linked</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Barcode">
            <input
              value={form.barcode}
              onChange={(event) => updateForm("barcode", event.target.value)}
              placeholder="Scan or enter barcode"
            />
          </Field>

          <Field label="Batch Number" required>
            <input
              value={form.batch}
              onChange={(event) => updateForm("batch", event.target.value)}
              placeholder="e.g. BATCH-2026-01"
            />
          </Field>

          <Field label="Expiry Date" required>
            <input
              type="date"
              value={form.expiry}
              onChange={(event) => updateForm("expiry", event.target.value)}
            />
          </Field>

          <Field label="Purchase Price" required>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.purchasePrice}
              onChange={(event) => updateForm("purchasePrice", event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="Sale Price" required>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.salePrice}
              onChange={(event) => updateForm("salePrice", event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field
            label="Quantity in Stock"
            required
            hint="Use stock adjustment for day-to-day corrections."
          >
            <input
              type="number"
              min="0"
              step="1"
              value={form.quantity}
              onChange={(event) => updateForm("quantity", event.target.value)}
              placeholder="0"
            />
          </Field>

          {formError && (
            <div className="form-alert form-alert-error field-span-2">{formError}</div>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(details)}
        onClose={() => setDetails(null)}
        title={details?.name || "Medicine Details"}
        subtitle={details?.genericName || details?.company || "Inventory record"}
        size="md"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDetails(null)}>
              Close
            </button>
            {canManage && details && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  openEditForm(details);
                  setDetails(null);
                }}
              >
                <Pencil size={15} /> Edit
              </button>
            )}
          </>
        }
      >
        {details && (
          <>
            {details.isDemo && (
              <div className="form-alert form-alert-warning demo-detail-warning">
                <strong>Demonstration record.</strong> Batch, barcode, price, expiry and
                supplier values are fictional demo data. Do not use for dispensing or real
                transactions.
              </div>
            )}
            <div className="detail-grid">
            {details.brandName && (
              <div>
                <span>Brand Name</span>
                <strong>{details.brandName}</strong>
              </div>
            )}
            <div>
              <span>Category</span>
              <strong>{details.category || "—"}</strong>
            </div>
            {details.dosageForm && (
              <div>
                <span>Dosage Form</span>
                <strong>{details.dosageForm}</strong>
              </div>
            )}
            {details.strength && (
              <div>
                <span>Strength</span>
                <strong>{details.strength}</strong>
              </div>
            )}
            <div>
              <span>Company</span>
              <strong>{details.company || details.manufacturer || "—"}</strong>
            </div>
            <div>
              <span>Supplier</span>
              <strong>{details.supplierName || "—"}</strong>
            </div>
            <div>
              <span>Barcode</span>
              <strong>{details.barcode || "—"}</strong>
            </div>
            <div>
              <span>Batch</span>
              <strong>{details.batch || "—"}</strong>
            </div>
            <div>
              <span>Expiry</span>
              <strong>{toDisplayDate(details.expiry)}</strong>
            </div>
            <div>
              <span>Purchase Price</span>
              <strong>{formatMoney(details.purchasePrice, settings)}</strong>
            </div>
            <div>
              <span>Sale Price</span>
              <strong>{formatMoney(details.salePrice, settings)}</strong>
            </div>
            <div>
              <span>Stock Quantity</span>
              <strong>{formatInteger(details.quantity)}</strong>
            </div>
            <div>
              <span>Stock Cost Value</span>
              <strong>
                {formatMoney(
                  Number(details.purchasePrice || 0) * Number(details.quantity || 0),
                  settings
                )}
              </strong>
            </div>
            <div>
              <span>Retail Value</span>
              <strong>
                {formatMoney(
                  Number(details.salePrice || 0) * Number(details.quantity || 0),
                  settings
                )}
              </strong>
            </div>
            <div>
              <span>Expiry Status</span>
              <strong>
                {expiryInfo(details.expiry, warningDays).status === "expired"
                  ? "Expired"
                  : expiryInfo(details.expiry, warningDays).label}
              </strong>
            </div>
            {details.lastStockAdjustment && (
              <div className="field-span-2">
                <span>Last Stock Adjustment</span>
                <strong>
                  {details.lastStockAdjustment.from} → {details.lastStockAdjustment.to} ·{" "}
                  {toDisplayDate(details.lastStockAdjustment.at)}
                  {details.lastStockAdjustment.reason
                    ? ` · ${details.lastStockAdjustment.reason}`
                    : ""}
                </strong>
              </div>
            )}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={demoOpen}
        onClose={() => {
          if (!demoImporting) setDemoOpen(false);
        }}
        title="Import Demo Tablets"
        subtitle={`${DEMO_TABLET_SET_LABEL} · ${DEMO_TABLET_SOURCE}`}
        size="xl"
        closeDisabled={demoImporting}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDemoOpen(false)}
              disabled={demoImporting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={importDemoTablets}
              disabled={
                demoImporting ||
                !demoConfirmed ||
                !demoValidation.valid ||
                demoValidation.newRecords.length === 0
              }
            >
              <Sparkles size={16} />
              {demoImporting
                ? "Importing…"
                : demoValidation.newRecords.length
                  ? `Import ${demoValidation.newRecords.length} Demo Tablets`
                  : "Nothing New to Import"}
            </button>
          </>
        }
      >
        <div className="demo-import">
          <div className="form-alert form-alert-warning demo-import-warning">
            <strong>Demonstration data only.</strong> These 50 tablet records are fictional
            demo inventory. Batch numbers, barcodes, prices, expiry dates and supplier links
            are examples — not verified real-world pharmacy information. Never use this sample
            inventory for dispensing or real commercial transactions.
          </div>

          <Field
            label="Link all demo records to an existing supplier"
            hint="Required. Demo records are never linked to an invented supplier identity."
          >
            <select
              value={demoSupplierId}
              onChange={(event) => {
                setDemoSupplierId(event.target.value);
                setDemoConfirmed(false);
                setDemoResult(null);
              }}
              disabled={demoImporting}
            >
              <option value="">
                {suppliers.length ? "Select a supplier" : "No suppliers available"}
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </Field>

          {!suppliers.length && (
            <div className="form-alert form-alert-error demo-import-errors">
              <p>
                No suppliers exist yet. Create a clearly labelled demo supplier here, or add a
                real supplier in the Suppliers page first.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={createDemoSupplier}
                disabled={demoCreatingSupplier || demoImporting}
              >
                <Sparkles size={15} />
                {demoCreatingSupplier ? "Creating…" : "Create Demo Supplier"}
              </button>
            </div>
          )}

          <div className="demo-summary">
            <div>
              <span>Records</span>
              <strong>{demoValidation.summary.count}</strong>
            </div>
            <div>
              <span>Categories</span>
              <strong>{demoValidation.summary.categories}</strong>
            </div>
            <div>
              <span>Total Units</span>
              <strong>{formatInteger(demoValidation.summary.units)}</strong>
            </div>
            <div>
              <span>Cost Value</span>
              <strong>{formatMoney(demoValidation.summary.costValue, settings)}</strong>
            </div>
            <div>
              <span>Retail Value</span>
              <strong>{formatMoney(demoValidation.summary.retailValue, settings)}</strong>
            </div>
            <div>
              <span>Potential Margin</span>
              <strong>{formatMoney(demoValidation.summary.margin, settings)}</strong>
            </div>
            <div>
              <span>Expiry Range</span>
              <strong>
                {toDisplayDate(demoValidation.summary.earliestExpiry)} —{" "}
                {toDisplayDate(demoValidation.summary.latestExpiry)}
              </strong>
            </div>
            <div>
              <span>New / Already Imported</span>
              <strong>
                {demoValidation.newRecords.length} / {demoValidation.alreadyImported.length}
              </strong>
            </div>
          </div>

          {demoResult && (
            <div
              className={`form-alert ${
                demoResult.inserted ? "demo-import-success" : "form-alert-warning"
              } demo-import-result`}
            >
              <strong>
                {demoResult.inserted
                  ? `${demoResult.inserted} demo tablet record${
                      demoResult.inserted === 1 ? "" : "s"
                    } inserted successfully.`
                  : "No new records were inserted."}
              </strong>{" "}
              {demoResult.skipped
                ? `${demoResult.skipped} record${
                    demoResult.skipped === 1 ? " was" : "s were"
                  } skipped because they already exist.`
                : ""}{" "}
              Linked to supplier: {demoResult.supplierName || "—"}. Existing medicines were
              not modified.
            </div>
          )}

          {demoValidation.errors.length > 0 && (
            <div className="form-alert form-alert-error demo-import-errors">
              <strong>Validation failed — nothing will be imported.</strong>
              <ul>
                {demoValidation.errors.slice(0, 12).map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              {demoValidation.errors.length > 12 && (
                <span>
                  …and {demoValidation.errors.length - 12} more validation issue
                  {demoValidation.errors.length - 12 === 1 ? "" : "s"}.
                </span>
              )}
            </div>
          )}

          <div className="demo-preview-head">
            <strong>Full preview — all 50 tablet records</strong>
            <span>
              Every row must be valid before the import button unlocks. Existing medicines are
              checked for barcode and name + batch conflicts.
            </span>
          </div>

          <div className="table-wrap demo-preview-wrap">
            <table className="data-table demo-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th>Generic</th>
                  <th>Category</th>
                  <th>Form</th>
                  <th>Strength</th>
                  <th>Company</th>
                  <th>Batch</th>
                  <th>Barcode</th>
                  <th>Expiry</th>
                  <th className="num">Purchase</th>
                  <th className="num">Sale</th>
                  <th className="num">Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {demoValidation.rows.map((row, index) => {
                  const record = row.record;

                  return (
                    <tr key={record.demoKey} className={`demo-row-${row.status}`}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="cell-primary">
                          <strong>{record.name}</strong>
                          <span>{record.brandName}</span>
                        </div>
                      </td>
                      <td>{record.genericName}</td>
                      <td>{record.category}</td>
                      <td>{record.dosageForm}</td>
                      <td>{record.strength}</td>
                      <td>{record.company}</td>
                      <td className="demo-mono">{record.batch}</td>
                      <td className="demo-mono">{record.barcode}</td>
                      <td>{toDisplayDate(record.expiry)}</td>
                      <td className="num">
                        {formatMoney(record.purchasePrice, settings)}
                      </td>
                      <td className="num">{formatMoney(record.salePrice, settings)}</td>
                      <td className="num">{formatInteger(record.quantity)}</td>
                      <td>
                        {row.status === "new" && <Badge tone="green">Ready</Badge>}
                        {row.status === "already" && (
                          <Badge tone="neutral">Already imported</Badge>
                        )}
                        {row.status === "conflict" && (
                          <Badge tone="red" title={row.errors.join(" ")}>
                            Conflict
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <label className="checkbox-row demo-confirm-row">
            <input
              type="checkbox"
              checked={demoConfirmed}
              onChange={(event) => setDemoConfirmed(event.target.checked)}
              disabled={demoImporting || !demoValidation.valid}
            />
            I understand these 50 records are demonstration data only and must not be used
            for dispensing or real transactions.
          </label>
        </div>
      </Modal>

      <Modal
        open={Boolean(adjustTarget)}
        onClose={() => {
          if (!adjusting) setAdjustTarget(null);
        }}
        title="Stock Adjustment"
        subtitle={
          adjustTarget
            ? `${adjustTarget.name} · batch ${adjustTarget.batch || "—"} · current stock ${adjustTarget.quantity}`
            : ""
        }
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAdjustTarget(null)}
              disabled={adjusting}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="stock-adjust-form"
              className="btn btn-primary"
              disabled={adjusting}
            >
              {adjusting ? "Applying…" : "Apply Adjustment"}
            </button>
          </>
        }
      >
        <form id="stock-adjust-form" onSubmit={applyAdjustment} className="form-grid">
          <Field label="Adjustment Type" required>
            <select
              value={adjustForm.mode}
              onChange={(event) =>
                setAdjustForm((previous) => ({ ...previous, mode: event.target.value }))
              }
            >
              <option value="add">Add to stock</option>
              <option value="remove">Remove from stock</option>
              <option value="set">Set exact stock level</option>
            </select>
          </Field>

          <Field label="Quantity" required>
            <input
              type="number"
              min="1"
              step="1"
              value={adjustForm.quantity}
              onChange={(event) =>
                setAdjustForm((previous) => ({ ...previous, quantity: event.target.value }))
              }
              placeholder="0"
              autoFocus
            />
          </Field>

          <Field label="Reason" className="field-span-2">
            <input
              value={adjustForm.reason}
              onChange={(event) =>
                setAdjustForm((previous) => ({ ...previous, reason: event.target.value }))
              }
              placeholder="e.g. damaged stock, stock count correction"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
