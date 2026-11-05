import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Download,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  TrendingDown,
  Wallet,
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
  downloadCSV,
  formatInteger,
  formatMoney,
  normalizeText,
  startOfMonthISO,
  toDisplayDate,
  todayISO,
} from "../lib/format";
import { EXPENSE_CATEGORIES } from "../lib/constants";

const PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Other"];

function emptyForm() {
  return {
    title: "",
    category: "Other",
    amount: "",
    paymentMethod: "Cash",
    date: todayISO(),
    description: "",
  };
}

export default function Expenses() {
  const settings = useSettings();
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();

  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = can("expenses.manage");
  const monthStart = startOfMonthISO();

  async function loadExpenses() {
    try {
      setError("");
      const records = await db.expenses.toArray();
      records.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
      setExpenses(records);
    } catch (loadError) {
      console.error("Expense loading failed:", loadError);
      setError("Unable to load expenses. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body to avoid a synchronous cascading render.
    Promise.resolve().then(loadExpenses);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return expenses.filter((expense) => {
      const matchesSearch =
        !term ||
        [expense.title, expense.category, expense.description, expense.paymentMethod].some(
          (value) => String(value || "").toLowerCase().includes(term)
        );
      const matchesCategory = categoryFilter === "all" || expense.category === categoryFilter;
      const matchesMonth = !monthFilter || String(expense.date || "").startsWith(monthFilter);
      const matchesStart = !startDate || String(expense.date || "") >= startDate;
      const matchesEnd = !endDate || String(expense.date || "") <= endDate;

      return matchesSearch && matchesCategory && matchesMonth && matchesStart && matchesEnd;
    });
  }, [expenses, search, categoryFilter, monthFilter, startDate, endDate]);

  const stats = useMemo(() => {
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const month = expenses
      .filter((expense) => String(expense.date || "").startsWith(monthStart.slice(0, 7)))
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const today = expenses
      .filter((expense) => expense.date === todayISO())
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

    return { total, month, today, count: expenses.length };
  }, [expenses, monthStart]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetFilters() {
    setSearch("");
    setCategoryFilter("all");
    setMonthFilter("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(expense) {
    setEditingId(expense.id);
    setForm({
      title: expense.title || "",
      category: expense.category || "Other",
      amount: String(expense.amount ?? ""),
      paymentMethod: expense.paymentMethod || "Cash",
      date: expense.date || todayISO(),
      description: expense.description || "",
    });
    setFormError("");
    setFormOpen(true);
  }

  function updateForm(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  async function saveExpense(event) {
    event.preventDefault();
    setFormError("");

    const title = normalizeText(form.title);
    const amount = Number(form.amount);

    if (!title) return setFormError("Expense title is required.");
    if (!Number.isFinite(amount) || amount <= 0) {
      return setFormError("Enter an amount greater than zero.");
    }
    if (!form.date) return setFormError("Select the expense date.");

    setSaving(true);

    try {
      const now = new Date().toISOString();
      const data = {
        title,
        category: form.category,
        amount: Math.round((amount + Number.EPSILON) * 100) / 100,
        paymentMethod: form.paymentMethod,
        date: form.date,
        description: normalizeText(form.description),
        updatedAt: now,
        updatedBy: user?.name || "",
      };

      if (editingId) {
        await db.expenses.update(editingId, data);
        toast.success(`${title} was updated.`, "Expense updated");
      } else {
        await db.expenses.add({
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          createdBy: user?.name || "",
        });
        toast.success(`${title} was recorded.`, "Expense added");
      }

      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm());
      await loadExpenses();
    } catch (saveError) {
      console.error("Expense save failed:", saveError);
      setFormError(saveError.message || "Unable to save expense.");
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(expense) {
    if (!canManage) return;
    const accepted = await confirm({
      title: "Delete this expense?",
      message: `${expense.title} · ${formatMoney(expense.amount, settings)} on ${toDisplayDate(
        expense.date
      )}. This affects expense reports and net profit.`,
      confirmLabel: "Delete expense",
      tone: "danger",
    });

    if (!accepted) return;

    try {
      await db.expenses.delete(expense.id);
      toast.success("Expense deleted.", "Expense removed");
      await loadExpenses();
    } catch (deleteError) {
      console.error("Expense delete failed:", deleteError);
      toast.error(deleteError.message || "Unable to delete expense.", "Delete failed");
    }
  }

  function exportCSV() {
    downloadCSV(
      `Expenses-${todayISO()}.csv`,
      ["Title", "Category", "Amount", "Payment Method", "Date", "Description", "Recorded By"],
      filtered.map((expense) => [
        expense.title,
        expense.category,
        Number(expense.amount || 0).toFixed(2),
        expense.paymentMethod,
        expense.date,
        expense.description || "",
        expense.createdBy || "",
      ])
    );
    toast.success(`${filtered.length} expenses exported as CSV.`, "Export complete");
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading expenses…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="FINANCE"
        title="Expenses"
        subtitle="Track operating costs that reduce net profit."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={exportCSV}>
              <Download size={16} />
              Export CSV
            </button>
            {canManage && (
              <button type="button" className="btn btn-primary" onClick={openAdd}>
                <Plus size={16} />
                Add Expense
              </button>
            )}
          </>
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-4">
        <StatTile
          icon={Wallet}
          tone="red"
          label="Total Expenses"
          value={formatMoney(stats.total, settings)}
          hint={`${formatInteger(stats.count)} records`}
        />
        <StatTile
          icon={CalendarDays}
          tone="orange"
          label="This Month"
          value={formatMoney(stats.month, settings)}
          hint="Current calendar month"
        />
        <StatTile
          icon={TrendingDown}
          tone="amber"
          label="Today"
          value={formatMoney(stats.today, settings)}
          hint="Expenses dated today"
        />
        <StatTile
          icon={Receipt}
          tone="blue"
          label="Filtered Records"
          value={formatInteger(filtered.length)}
          hint={`${formatMoney(
            filtered.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
            settings
          )} in view`}
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
            placeholder="Search title, category, description or payment method…"
          />

          <div className="toolbar-filters">
            <Field label="Category">
              <select
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All categories</option>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Month">
              <input
                type="month"
                value={monthFilter}
                onChange={(event) => {
                  setMonthFilter(event.target.value);
                  setPage(1);
                }}
              />
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
            icon={Receipt}
            title={expenses.length === 0 ? "No expenses recorded" : "No matching expenses"}
            message={
              expenses.length === 0
                ? "Add rent, salaries, utilities and other operating costs here."
                : "Adjust the filters or search term."
            }
            action={
              expenses.length === 0 && canManage ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>
                  <Plus size={15} /> Add Expense
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
                    <th>Expense</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th>Payment</th>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((expense) => (
                    <tr key={expense.id}>
                      <td>
                        <div className="cell-primary">
                          <strong>{expense.title}</strong>
                          <span>{expense.createdBy || "Recorded locally"}</span>
                        </div>
                      </td>
                      <td>
                        <Badge tone="neutral">{expense.category}</Badge>
                      </td>
                      <td className="num">
                        <strong className="text-danger">{formatMoney(expense.amount, settings)}</strong>
                      </td>
                      <td>{expense.paymentMethod}</td>
                      <td>{toDisplayDate(expense.date)}</td>
                      <td className="cell-muted">{expense.description || "—"}</td>
                      <td>
                        <div className="row-actions">
                          {canManage ? (
                            <>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Edit expense"
                                onClick={() => openEdit(expense)}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                type="button"
                                className="btn-icon btn-icon-danger"
                                title="Delete expense"
                                onClick={() => requestDelete(expense)}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <span className="cell-muted">View only</span>
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
        title={editingId ? "Edit Expense" : "Add Expense"}
        subtitle="Expenses reduce net profit in reports."
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
            <button type="submit" form="expense-form" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Update Expense" : "Save Expense"}
            </button>
          </>
        }
      >
        <form id="expense-form" onSubmit={saveExpense} className="form-grid">
          <Field label="Expense Title" required className="field-span-2">
            <input
              value={form.title}
              onChange={(event) => updateForm("title", event.target.value)}
              placeholder="e.g. Shop rent for November"
              autoFocus
            />
          </Field>

          <Field label="Category" required>
            <select
              value={form.category}
              onChange={(event) => updateForm("category", event.target.value)}
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Amount (${settings.currency || "PKR"})`} required>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => updateForm("amount", event.target.value)}
              placeholder="0.00"
            />
          </Field>

          <Field label="Payment Method" required>
            <select
              value={form.paymentMethod}
              onChange={(event) => updateForm("paymentMethod", event.target.value)}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Expense Date" required>
            <input
              type="date"
              value={form.date}
              max={todayISO()}
              onChange={(event) => updateForm("date", event.target.value)}
            />
          </Field>

          <Field label="Description" className="field-span-2">
            <textarea
              rows="3"
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
              placeholder="Optional details or reference number"
            />
          </Field>

          {formError && <div className="form-alert form-alert-error field-span-2">{formError}</div>}
        </form>
      </Modal>
    </div>
  );
}
