import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download,
  Eye,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useSettings, useLogo } from "../hooks/useSettings";
import { useUI } from "../context/UIContext";
import Modal from "../components/ui/Modal";
import InvoiceView from "../components/InvoiceView";
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
  isCompletedSale,
  saleCost,
  saleHasCompleteCost,
  saleItemCount,
  toDisplayDate,
  toDisplayDateTime,
  todayISO,
} from "../lib/format";
import { printSaleInvoice } from "../lib/print";

export default function SalesHistory() {
  const settings = useSettings();
  const logo = useLogo();
  const { user, can } = useAuth();
  const { toast, confirm } = useUI();
  const navigate = useNavigate();

  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [selectedSale, setSelectedSale] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);

  async function loadSales() {
    try {
      setError("");
      const records = await db.sales.toArray();
      records.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setSales(records);
    } catch (loadError) {
      console.error("Sales loading failed:", loadError);
      setError("Unable to load sales history. Please refresh the page.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Defer past the effect body to avoid a synchronous cascading render.
    Promise.resolve().then(loadSales);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return sales.filter((sale) => {
      const saleDate = String(sale.createdAt || "").slice(0, 10);
      const matchesSearch =
        !term ||
        [sale.invoiceNumber, sale.customerName, sale.customerPhone, sale.cashierName, sale.cashier?.name]
          .some((value) => String(value || "").toLowerCase().includes(term));

      const matchesStart = !startDate || (saleDate && saleDate >= startDate);
      const matchesEnd = !endDate || (saleDate && saleDate <= endDate);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "completed" && isCompletedSale(sale)) ||
        (statusFilter === "cancelled" && !isCompletedSale(sale));
      const matchesPayment =
        paymentFilter === "all" || (sale.paymentMethod || "Cash") === paymentFilter;

      return matchesSearch && matchesStart && matchesEnd && matchesStatus && matchesPayment;
    });
  }, [sales, search, startDate, endDate, statusFilter, paymentFilter]);

  const model = useMemo(() => {
    const completed = filtered.filter(isCompletedSale);
    const cancelled = filtered.filter((sale) => !isCompletedSale(sale));
    const revenue = completed.reduce((total, sale) => total + Number(sale.grandTotal || 0), 0);
    const costed = completed.filter(saleHasCompleteCost);
    const uncosted = completed.filter((sale) => !saleHasCompleteCost(sale));
    const cogs = costed.reduce((total, sale) => total + saleCost(sale), 0);
    const grossProfit = costed.reduce(
      (total, sale) => total + Number(sale.grandTotal || 0) - saleCost(sale),
      0
    );
    const excludedRevenue = uncosted.reduce(
      (total, sale) => total + Number(sale.grandTotal || 0),
      0
    );

    return {
      completedCount: completed.length,
      cancelledCount: cancelled.length,
      revenue,
      cogs,
      grossProfit,
      uncostedCount: uncosted.length,
      excludedRevenue,
      costedCount: costed.length,
    };
  }, [filtered]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetFilters() {
    setSearch("");
    setStartDate("");
    setEndDate("");
    setStatusFilter("all");
    setPaymentFilter("all");
    setPage(1);
  }

  function printSale(sale) {
    const opened = printSaleInvoice(sale, settings, logo);
    if (!opened) {
      toast.error("Allow pop-ups in your browser to print the invoice.", "Print blocked");
    }
  }

  function exportCSV() {
    downloadCSV(
      `Sales-History-${todayISO()}.csv`,
      [
        "Invoice",
        "Date",
        "Customer",
        "Phone",
        "Items",
        "Subtotal",
        "Discount",
        "Grand Total",
        "Payment Method",
        "Status",
        "Served By",
        "Cost Recorded",
      ],
      filtered.map((sale) => [
        sale.invoiceNumber,
        toDisplayDateTime(sale.createdAt),
        sale.customerName || "Walk-in Customer",
        sale.customerPhone || "",
        saleItemCount(sale),
        Number(sale.subtotal || 0).toFixed(2),
        Number(sale.discount || 0).toFixed(2),
        Number(sale.grandTotal || 0).toFixed(2),
        sale.paymentMethod || "Cash",
        isCompletedSale(sale) ? "Completed" : "Cancelled",
        sale.cashier?.name || sale.cashierName || "",
        saleHasCompleteCost(sale) ? "Yes" : "No",
      ])
    );
    toast.success(`${filtered.length} invoices exported as CSV.`, "Export complete");
  }

  async function cancelSale(sale) {
    if (cancellingId) return;

    if (!isCompletedSale(sale)) {
      toast.info("This invoice is already cancelled.", "No action needed");
      return;
    }

    const accepted = await confirm({
      title: `Cancel invoice ${sale.invoiceNumber || ""}?`,
      message:
        "The invoice will be marked as cancelled and every sold quantity will be returned to inventory. This action is recorded and cannot be undone.",
      confirmLabel: "Cancel invoice",
      tone: "danger",
    });

    if (!accepted) return;

    setCancellingId(sale.id);
    setError("");

    try {
      let missing = [];

      await db.transaction("rw", db.sales, db.medicines, async () => {
        const current = await db.sales.get(sale.id);

        if (!current) throw new Error("This invoice could not be found.");
        if (!isCompletedSale(current)) throw new Error("This sale has already been cancelled.");
        if (!Array.isArray(current.items) || current.items.length === 0) {
          throw new Error("Invoice items are missing. Stock was not changed.");
        }

        for (const item of current.items) {
          const quantity = Number(item.quantity);

          if (!Number.isInteger(quantity) || quantity <= 0) {
            throw new Error(`Invalid quantity recorded for ${item.name || "an item"}.`);
          }

          const medicine = await db.medicines.get(item.medicineId);

          if (!medicine) {
            missing.push(item.name || item.medicineId);
            continue;
          }

          await db.medicines.update(item.medicineId, {
            quantity: Number(medicine.quantity || 0) + quantity,
            updatedAt: new Date().toISOString(),
          });
        }

        await db.sales.update(sale.id, {
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          cancelledBy: user?.name || "Unknown user",
          restock: {
            restoredAt: new Date().toISOString(),
            missingMedicines: missing,
          },
        });
      });

      toast.success(
        missing.length
          ? `Invoice cancelled. ${missing.length} medicine record(s) no longer exist, so their stock could not be restored.`
          : "Invoice cancelled and all sold quantities were returned to stock.",
        "Sale cancelled"
      );

      if (selectedSale?.id === sale.id) {
        setSelectedSale(await db.sales.get(sale.id));
      }

      await loadSales();
    } catch (cancelError) {
      console.error("Sale cancellation failed:", cancelError);
      setError(cancelError.message || "Unable to cancel this sale.");
      toast.error(cancelError.message || "Unable to cancel this sale.", "Cancellation failed");
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading sales history…" />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Sales History"
        subtitle="Review invoices, verify profit coverage, reprint receipts and safely cancel sales."
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={exportCSV}>
              <Download size={16} />
              Export CSV
            </button>
            {can("pos.use") && (
              <button type="button" className="btn btn-primary" onClick={() => navigate("/pos")}>
                <Plus size={16} />
                New Sale
              </button>
            )}
          </>
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="stat-grid stat-grid-4">
        <StatTile
          icon={Receipt}
          tone="blue"
          label="Invoices Shown"
          value={formatInteger(filtered.length)}
          hint={`${model.completedCount} completed · ${model.cancelledCount} cancelled`}
        />
        <StatTile
          icon={TrendingUp}
          tone="green"
          label="Sales Revenue"
          value={formatMoney(model.revenue, settings)}
          hint="Completed invoices only"
        />
        <StatTile
          icon={TrendingUp}
          tone="indigo"
          label="Gross Profit"
          value={formatMoney(model.grossProfit, settings)}
          hint={`COGS ${formatMoney(model.cogs, settings)}`}
        />
        <StatTile
          icon={XCircle}
          tone="amber"
          label="Cost Coverage"
          value={`${model.costedCount} / ${model.completedCount || 0}`}
          hint={
            model.uncostedCount > 0
              ? `${formatMoney(model.excludedRevenue, settings)} revenue excluded`
              : "All completed sales have cost data"
          }
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
            placeholder="Search invoice, customer, phone or cashier…"
          />

          <div className="toolbar-filters">
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

            <Field label="Status">
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>

            <Field label="Payment">
              <select
                value={paymentFilter}
                onChange={(event) => {
                  setPaymentFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All methods</option>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Other">Other</option>
              </select>
            </Field>

            <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
              Reset
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={sales.length === 0 ? "No sales recorded yet" : "No matching invoices"}
            message={
              sales.length === 0
                ? "Complete a sale in POS to see it here."
                : "Adjust the date range, status or search term."
            }
            action={
              sales.length === 0 && can("pos.use") ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate("/pos")}>
                  <Plus size={15} /> Open POS
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
                    <th>Customer</th>
                    <th>Date</th>
                    <th>Served By</th>
                    <th className="num">Items</th>
                    <th className="num">Total</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th className="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((sale) => {
                    const completed = isCompletedSale(sale);
                    return (
                      <tr key={sale.id}>
                        <td>
                          <div className="cell-primary">
                            <strong>{sale.invoiceNumber || "—"}</strong>
                            <span>{saleHasCompleteCost(sale) ? "Cost recorded" : "Legacy cost missing"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-primary">
                            <strong>{sale.customerName || "Walk-in Customer"}</strong>
                            <span>{sale.customerPhone || "—"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="cell-primary">
                            <strong>{toDisplayDate(sale.createdAt)}</strong>
                            <span>{toDisplayDateTime(sale.createdAt).split(", ")[1] || "—"}</span>
                          </div>
                        </td>
                        <td>{sale.cashier?.name || sale.cashierName || "—"}</td>
                        <td className="num">{formatInteger(saleItemCount(sale))}</td>
                        <td className="num">
                          <strong>{formatMoney(sale.grandTotal, settings)}</strong>
                        </td>
                        <td>{sale.paymentMethod || "Cash"}</td>
                        <td>
                          <Badge tone={completed ? "green" : "red"} dot>
                            {completed ? "Completed" : "Cancelled"}
                          </Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn-icon"
                              title="View invoice"
                              onClick={() => setSelectedSale(sale)}
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon"
                              title="Print invoice"
                              onClick={() => printSale(sale)}
                            >
                              <Printer size={16} />
                            </button>
                            {completed && can("sales.cancel") && (
                              <button
                                type="button"
                                className="btn-icon btn-icon-danger"
                                title="Cancel sale and restore stock"
                                disabled={cancellingId === sale.id}
                                onClick={() => cancelSale(sale)}
                              >
                                <RotateCcw size={16} />
                              </button>
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

      {model.uncostedCount > 0 && (
        <p className="page-footnote">
          {model.uncostedCount} completed sale{model.uncostedCount === 1 ? "" : "s"} without a
          recorded cost price are excluded from gross profit ({formatMoney(model.excludedRevenue, settings)}{" "}
          of revenue). These are legacy invoices created before cost snapshots were introduced.
        </p>
      )}

      <Modal
        open={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        title={selectedSale?.invoiceNumber || "Invoice"}
        subtitle={
          selectedSale
            ? `${toDisplayDateTime(selectedSale.createdAt)} · ${
                isCompletedSale(selectedSale) ? "Completed" : "Cancelled"
              }`
            : ""
        }
        size="xl"
        footer={
          selectedSale ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedSale(null)}>
                Close
              </button>
              {isCompletedSale(selectedSale) && can("sales.cancel") && (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={cancellingId === selectedSale.id}
                  onClick={() => cancelSale(selectedSale)}
                >
                  <RotateCcw size={16} />
                  {cancellingId === selectedSale.id ? "Cancelling…" : "Cancel Sale"}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => printSale(selectedSale)}>
                <Printer size={16} />
                Print Invoice
              </button>
            </>
          ) : null
        }
      >
        {selectedSale && (
          <InvoiceView sale={selectedSale} settings={settings} logo={logo} />
        )}
      </Modal>
    </div>
  );
}
