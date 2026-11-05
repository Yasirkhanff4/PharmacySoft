import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Truck,
  Users,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
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
  isValidEmail,
  isValidPhone,
  normalizeText,
} from "../lib/format";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "" };

export default function Suppliers() {
  const settings = useSettings();
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();

  const [suppliers, setSuppliers] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = can("suppliers.manage");

  async function loadData() {
    try {
      setError("");
      const [supplierRecords, medicineRecords, purchaseRecords] = await Promise.all([
        db.suppliers.toArray(),
        db.medicines.toArray(),
        db.purchases.toArray(),
      ]);

      supplierRecords.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      setSuppliers(supplierRecords);
      setMedicines(medicineRecords);
      setPurchases(purchaseRecords);
    } catch (loadError) {
      console.error("Supplier loading failed:", loadError);
      setError("Unable to load suppliers. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body to avoid a synchronous cascading render.
    Promise.resolve().then(loadData);
  }, []);

  const supplierStats = useMemo(() => {
    const map = new Map();

    medicines.forEach((medicine) => {
      if (!medicine.supplierId) return;
      const current = map.get(medicine.supplierId) || { medicines: 0, units: 0, value: 0, purchases: 0, purchaseValue: 0 };
      current.medicines += 1;
      current.units += Number(medicine.quantity || 0);
      current.value += Number(medicine.purchasePrice || 0) * Number(medicine.quantity || 0);
      map.set(medicine.supplierId, current);
    });

    purchases.forEach((purchase) => {
      if (!purchase.supplierId) return;
      const current = map.get(purchase.supplierId) || { medicines: 0, units: 0, value: 0, purchases: 0, purchaseValue: 0 };
      current.purchases += 1;
      current.purchaseValue += Number(purchase.grandTotal || 0);
      map.set(purchase.supplierId, current);
    });

    return map;
  }, [medicines, purchases]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return suppliers;

    return suppliers.filter((supplier) =>
      [supplier.name, supplier.phone, supplier.email, supplier.address].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [suppliers, search]);

  const totals = useMemo(
    () => ({
      active: suppliers.length,
      linkedMedicines: medicines.filter((medicine) => medicine.supplierId).length,
      purchaseValue: purchases.reduce((total, purchase) => total + Number(purchase.grandTotal || 0), 0),
    }),
    [suppliers, medicines, purchases]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(supplier) {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
    });
    setFormError("");
    setFormOpen(true);
  }

  function updateForm(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function saveSupplier(event) {
    event.preventDefault();
    setFormError("");

    const name = normalizeText(form.name);
    const phone = normalizeText(form.phone);
    const email = normalizeText(form.email);
    const address = normalizeText(form.address);

    if (!name) return setFormError("Supplier name is required.");
    if (phone && !isValidPhone(phone)) return setFormError("Enter a valid phone number.");
    if (!isValidEmail(email)) return setFormError("Enter a valid email address.");

    const duplicate = suppliers.find(
      (supplier) =>
        supplier.id !== editingId &&
        String(supplier.name || "").toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      return setFormError(`A supplier named "${duplicate.name}" already exists.`);
    }

    setSaving(true);

    try {
      const now = new Date().toISOString();
      const data = { name, phone, email, address, updatedAt: now, updatedBy: user?.name || "" };

      if (editingId) {
        await db.suppliers.update(editingId, data);
        // Keep the denormalised supplier name used by inventory records in sync.
        const linkedMedicines = medicines.filter((medicine) => medicine.supplierId === editingId);
        if (linkedMedicines.length > 0) {
          await db.medicines.bulkPut(
            linkedMedicines.map((medicine) => ({ ...medicine, supplierName: name }))
          );
        }
        toast.success(`${name} was updated.`, "Supplier updated");
      } else {
        await db.suppliers.add({
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          createdBy: user?.name || "",
        });
        toast.success(`${name} was added.`, "Supplier added");
      }

      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (saveError) {
      console.error("Supplier save failed:", saveError);
      setFormError(saveError.message || "Unable to save supplier.");
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(supplier) {
    if (!canManage) return;

    const stats = supplierStats.get(supplier.id) || {};
    const linked = Number(stats.medicines || 0);
    const purchaseCount = Number(stats.purchases || 0);

    const accepted = await confirm({
      title: `Delete ${supplier.name}?`,
      message: `${
        linked || purchaseCount
          ? `This supplier is linked to ${linked} medicine record(s) and ${purchaseCount} purchase invoice(s). Purchase history will be preserved with the supplier name, and medicine supplier links will be cleared.`
          : "This supplier has no linked records."
      } This action cannot be undone.`,
      confirmLabel: "Delete supplier",
      tone: "danger",
    });

    if (!accepted) return;

    try {
      await db.transaction("rw", db.suppliers, db.medicines, async () => {
        const linkedMedicines = medicines.filter((medicine) => medicine.supplierId === supplier.id);
        if (linkedMedicines.length > 0) {
          await db.medicines.bulkPut(
            linkedMedicines.map((medicine) => ({
              ...medicine,
              supplierId: "",
              supplierName: "",
              updatedAt: new Date().toISOString(),
            }))
          );
        }
        await db.suppliers.delete(supplier.id);
      });

      toast.success(`${supplier.name} was deleted. Purchase history was preserved.`, "Supplier deleted");
      await loadData();
    } catch (deleteError) {
      console.error("Supplier delete failed:", deleteError);
      toast.error(deleteError.message || "Unable to delete supplier.", "Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading suppliers…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="INVENTORY"
        title="Suppliers"
        subtitle="Keep supplier contacts and purchase relationships in one place."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Plus size={16} />
              Add Supplier
            </button>
          )
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-3">
        <StatTile
          icon={Users}
          tone="blue"
          label="Total Suppliers"
          value={formatInteger(totals.active)}
          hint="Active supplier directory"
        />
        <StatTile
          icon={Truck}
          tone="indigo"
          label="Linked Medicines"
          value={formatInteger(totals.linkedMedicines)}
          hint="Inventory records with a supplier"
        />
        <StatTile
          icon={Truck}
          tone="green"
          label="Purchase Value"
          value={formatMoney(totals.purchaseValue, settings)}
          hint="All recorded supplier invoices"
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
            placeholder="Search supplier name, phone, email or address…"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={suppliers.length === 0 ? "No suppliers yet" : "No matching suppliers"}
            message={
              suppliers.length === 0
                ? "Add a supplier before recording purchases."
                : "Try a different search term."
            }
            action={
              suppliers.length === 0 && canManage ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                  <Plus size={15} /> Add Supplier
                </button>
              ) : null
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th>Address</th>
                    <th className="num">Medicines</th>
                    <th className="num">Purchases</th>
                    <th className="num">Purchase Value</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((supplier) => {
                    const stats = supplierStats.get(supplier.id) || {};
                    return (
                      <tr key={supplier.id}>
                        <td>
                          <div className="cell-with-avatar">
                            <span className="avatar-circle">{supplier.name.charAt(0).toUpperCase()}</span>
                            <div className="cell-primary">
                              <strong>{supplier.name}</strong>
                              <span>{stats.units || 0} units linked</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="cell-stack">
                            {supplier.phone ? (
                              <span className="inline-icon">
                                <Phone size={13} /> {supplier.phone}
                              </span>
                            ) : null}
                            {supplier.email ? (
                              <span className="inline-icon">
                                <Mail size={13} /> {supplier.email}
                              </span>
                            ) : null}
                            {!supplier.phone && !supplier.email && <span>—</span>}
                          </div>
                        </td>
                        <td>
                          {supplier.address ? (
                            <span className="inline-icon">
                              <MapPin size={13} /> {supplier.address}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">{formatInteger(stats.medicines || 0)}</td>
                        <td className="num">{formatInteger(stats.purchases || 0)}</td>
                        <td className="num">
                          <strong>{formatMoney(stats.purchaseValue || 0, settings)}</strong>
                        </td>
                        <td>
                          <div className="row-actions">
                            {canManage ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title="Edit supplier"
                                  onClick={() => openEdit(supplier)}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon btn-icon-danger"
                                  title="Delete supplier"
                                  onClick={() => requestDelete(supplier)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : (
                              <Badge tone="neutral">{supplier.phone || supplier.email || "—"}</Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
        title={editingId ? "Edit Supplier" : "Add Supplier"}
        subtitle="Contact details are used on purchase invoices."
        size="md"
        closeDisabled={saving}
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
            <button type="submit" form="supplier-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Update Supplier" : "Save Supplier"}
            </button>
          </>
        }
      >
        <form id="supplier-form" onSubmit={saveSupplier} className="form-grid">
          <Field label="Supplier Name" required className="field-span-2">
            <input
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="e.g. MedSupply Distributors"
              autoFocus
            />
          </Field>

          <Field label="Phone">
            <input
              type="tel"
              value={form.phone}
              onChange={(event) => updateForm("phone", event.target.value)}
              placeholder="03XXXXXXXXX"
            />
          </Field>

          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(event) => updateForm("email", event.target.value)}
              placeholder="supplier@example.com"
            />
          </Field>

          <Field label="Address" className="field-span-2">
            <textarea
              rows="3"
              value={form.address}
              onChange={(event) => updateForm("address", event.target.value)}
              placeholder="Street, city"
            />
          </Field>

          {formError && <div className="form-alert form-alert-error field-span-2">{formError}</div>}
        </form>
      </Modal>
    </div>
  );
}
