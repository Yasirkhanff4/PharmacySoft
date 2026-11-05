import { useEffect, useMemo, useState } from "react";
import {
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Trash2,
  UserRound,
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
  isCompletedSale,
  isValidEmail,
  isValidPhone,
  normalizeText,
  toDisplayDate,
} from "../lib/format";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "" };

export default function Customers() {
  const settings = useSettings();
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();

  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
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

  const canManage = can("customers.manage");

  async function loadData() {
    try {
      const [customerRecords, saleRecords] = await Promise.all([
        db.customers.toArray(),
        db.sales.toArray(),
      ]);

      customerRecords.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""))
      );

      setError("");
      setCustomers(customerRecords);
      setSales(saleRecords);
    } catch (loadError) {
      console.error("Customer loading failed:", loadError);
      setError("Unable to load customers. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body so the initial load cannot trigger a
    // synchronous cascading render (React Compiler rule).
    Promise.resolve().then(loadData);
  }, []);

  const customerStats = useMemo(() => {
    const map = new Map();

    sales.filter(isCompletedSale).forEach((sale) => {
      const key = sale.customerId || "";
      if (!key) return;
      const current = map.get(key) || { orders: 0, spent: 0, last: "" };
      current.orders += 1;
      current.spent += Number(sale.grandTotal || 0);
      if (String(sale.createdAt || "") > current.last) current.last = String(sale.createdAt || "");
      map.set(key, current);
    });

    customers.forEach((customer) => {
      if (map.has(customer.id) || !customer.phone) return;

      const matched = sales
        .filter(isCompletedSale)
        .filter(
          (sale) =>
            !sale.customerId &&
            String(sale.customerPhone || "").replace(/\s+/g, "") ===
              String(customer.phone || "").replace(/\s+/g, "")
        );

      if (matched.length > 0) {
        const current = { orders: 0, spent: 0, last: "" };
        matched.forEach((sale) => {
          current.orders += 1;
          current.spent += Number(sale.grandTotal || 0);
          if (String(sale.createdAt || "") > current.last) current.last = String(sale.createdAt || "");
        });
        map.set(customer.id, current);
      }
    });

    return map;
  }, [customers, sales]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;

    return customers.filter((customer) =>
      [customer.name, customer.phone, customer.email, customer.address].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [customers, search]);

  const totals = useMemo(() => {
    let repeat = 0;
    let spent = 0;
    customerStats.forEach((value) => {
      if (value.orders > 1) repeat += 1;
      spent += value.spent;
    });
    return { repeat, spent };
  }, [customerStats]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(customer) {
    setEditingId(customer.id);
    setForm({
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
    });
    setFormError("");
    setFormOpen(true);
  }

  function updateForm(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function saveCustomer(event) {
    event.preventDefault();
    setFormError("");

    const name = normalizeText(form.name);
    const phone = normalizeText(form.phone);
    const email = normalizeText(form.email);
    const address = normalizeText(form.address);

    if (!name) return setFormError("Customer name is required.");
    if (!phone) return setFormError("Customer phone number is required.");
    if (!isValidPhone(phone)) return setFormError("Enter a valid phone number.");
    if (!isValidEmail(email)) return setFormError("Enter a valid email address.");

    const duplicate = customers.find(
      (customer) =>
        customer.id !== editingId &&
        String(customer.phone || "").replace(/\s+/g, "") === phone.replace(/\s+/g, "")
    );

    if (duplicate) {
      return setFormError(`A customer with this phone number already exists (${duplicate.name}).`);
    }

    setSaving(true);

    try {
      const now = new Date().toISOString();
      const data = { name, phone, email, address, updatedAt: now, updatedBy: user?.name || "" };

      if (editingId) {
        await db.customers.update(editingId, data);
        toast.success(`${name} was updated.`, "Customer updated");
      } else {
        await db.customers.add({
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          createdBy: user?.name || "",
        });
        toast.success(`${name} was added.`, "Customer added");
      }

      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (saveError) {
      console.error("Customer save failed:", saveError);
      setFormError(saveError.message || "Unable to save customer.");
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(customer) {
    if (!canManage) return;

    const stats = customerStats.get(customer.id);
    const accepted = await confirm({
      title: `Delete ${customer.name}?`,
      message: `${
        stats?.orders
          ? `This customer has ${stats.orders} completed sale invoice(s). Those financial records will be preserved with the stored customer name.`
          : "This customer has no completed sales."
      } The customer record will be removed from the directory.`,
      confirmLabel: "Delete customer",
      tone: "danger",
    });

    if (!accepted) return;

    try {
      await db.customers.delete(customer.id);
      toast.success(`${customer.name} was deleted. Sales history was preserved.`, "Customer deleted");
      await loadData();
    } catch (deleteError) {
      console.error("Customer delete failed:", deleteError);
      toast.error(deleteError.message || "Unable to delete customer.", "Delete failed");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading customers…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title="Customers"
        subtitle="A clean directory of customers linked to your sales history."
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={openAdd}>
              <Plus size={16} />
              Add Customer
            </button>
          )
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-3">
        <StatTile
          icon={Users}
          tone="blue"
          label="Total Customers"
          value={formatInteger(customers.length)}
          hint="Registered customer records"
        />
        <StatTile
          icon={Receipt}
          tone="green"
          label="Repeat Customers"
          value={formatInteger(totals.repeat)}
          hint="More than one completed sale"
        />
        <StatTile
          icon={UserRound}
          tone="indigo"
          label="Customer Revenue"
          value={formatMoney(totals.spent, settings)}
          hint="Completed sales linked to customers"
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
            placeholder="Search name, phone, email or address…"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={customers.length === 0 ? "No customers yet" : "No matching customers"}
            message={
              customers.length === 0
                ? "Add a customer, or let POS create one automatically at checkout."
                : "Try a different search term."
            }
            action={
              customers.length === 0 && canManage ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                  <Plus size={15} /> Add Customer
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
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Address</th>
                    <th className="num">Orders</th>
                    <th className="num">Spent</th>
                    <th>Last Visit</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((customer) => {
                    const stats = customerStats.get(customer.id) || {};
                    return (
                      <tr key={customer.id}>
                        <td>
                          <div className="cell-with-avatar">
                            <span className="avatar-circle">
                              {customer.name.charAt(0).toUpperCase()}
                            </span>
                            <div className="cell-primary">
                              <strong>{customer.name}</strong>
                              <span>{toDisplayDate(customer.createdAt)}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="inline-icon">
                            <Phone size={13} /> {customer.phone || "—"}
                          </span>
                        </td>
                        <td>
                          {customer.email ? (
                            <span className="inline-icon">
                              <Mail size={13} /> {customer.email}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {customer.address ? (
                            <span className="inline-icon">
                              <MapPin size={13} /> {customer.address}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="num">{formatInteger(stats.orders || 0)}</td>
                        <td className="num">
                          <strong>{formatMoney(stats.spent || 0, settings)}</strong>
                        </td>
                        <td>
                          {stats.last ? (
                            toDisplayDate(stats.last)
                          ) : (
                            <Badge tone="neutral">No sales</Badge>
                          )}
                        </td>
                        <td>
                          <div className="row-actions">
                            {canManage ? (
                              <>
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title="Edit customer"
                                  onClick={() => openEdit(customer)}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn-icon btn-icon-danger"
                                  title="Delete customer"
                                  onClick={() => requestDelete(customer)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : (
                              <Badge tone="neutral">{customer.phone || "—"}</Badge>
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
        title={editingId ? "Edit Customer" : "Add Customer"}
        subtitle="Phone numbers are unique so sales stay linked to the right person."
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
            <button type="submit" form="customer-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Update Customer" : "Save Customer"}
            </button>
          </>
        }
      >
        <form id="customer-form" onSubmit={saveCustomer} className="form-grid">
          <Field label="Customer Name" required className="field-span-2">
            <input
              value={form.name}
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="e.g. Ayesha Khan"
              autoFocus
            />
          </Field>

          <Field label="Phone" required>
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
              placeholder="customer@example.com"
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
