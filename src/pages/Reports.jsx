import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CalendarX,
  Download,
  Package,
  Printer,
  Receipt,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { db } from "../database/db";
import { useSettings } from "../hooks/useSettings";
import { useUI } from "../context/UIContext";
import {
  Badge,
  EmptyState,
  Field,
  LoadingBlock,
  PageHeader,
  StatTile,
} from "../components/ui/primitives";
import {
  downloadCSV,
  expiryInfo,
  formatInteger,
  formatMoney,
  getBucketKey,
  getStockStatus,
  hasRecordedCost,
  isCompletedSale,
  prettyBucket,
  saleCost,
  saleHasCompleteCost,
  saleItemCount,
  startOfMonthISO,
  startOfWeekISO,
  startOfYearISO,
  toDateKey,
  toDisplayDate,
  todayISO,
} from "../lib/format";

function inDateRange(date, start, end) {
  const day = toDateKey(date);
  if (!day) return false;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

export default function Reports() {
  const settings = useSettings();
  const { toast } = useUI();

  const [data, setData] = useState({
    sales: [],
    purchases: [],
    expenses: [],
    medicines: [],
    suppliers: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [startDate, setStartDate] = useState(startOfMonthISO);
  const [endDate, setEndDate] = useState(todayISO);
  const [groupBy, setGroupBy] = useState("day");

  const lowLimit = Number(settings.lowStockLimit) || 10;
  const warningDays = Number(settings.expiryWarningDays) || 30;

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [sales, purchases, expenses, medicines, suppliers] = await Promise.all([
          db.sales.toArray(),
          db.purchases.toArray(),
          db.expenses.toArray(),
          db.medicines.toArray(),
          db.suppliers.toArray(),
        ]);

        if (!active) return;
        setData({ sales, purchases, expenses, medicines, suppliers });
      } catch (loadError) {
        console.error("Report loading failed:", loadError);
        if (active) setError("Unable to load report data. Please refresh the page.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const report = useMemo(() => {
    const completedSales = data.sales.filter(
      (sale) =>
        isCompletedSale(sale) &&
        inDateRange(sale.createdAt, startDate, endDate)
    );

    const rangePurchases = data.purchases.filter(
      (purchase) =>
        purchase.status !== "cancelled" &&
        inDateRange(purchase.purchaseDate || purchase.createdAt, startDate, endDate)
    );

    const rangeExpenses = data.expenses.filter((expense) =>
      inDateRange(expense.date, startDate, endDate)
    );

    const revenue = completedSales.reduce(
      (sum, sale) => sum + Number(sale.grandTotal || 0),
      0
    );

    const costedSales = completedSales.filter(saleHasCompleteCost);
    const uncostedSales = completedSales.filter((sale) => !saleHasCompleteCost(sale));
    const costedRevenue = costedSales.reduce(
      (sum, sale) => sum + Number(sale.grandTotal || 0),
      0
    );
    const cogs = costedSales.reduce((sum, sale) => sum + saleCost(sale), 0);
    const grossProfit = costedRevenue - cogs;
    const excludedRevenue = uncostedSales.reduce(
      (sum, sale) => sum + Number(sale.grandTotal || 0),
      0
    );

    const purchaseValue = rangePurchases.reduce(
      (sum, purchase) => sum + Number(purchase.grandTotal || 0),
      0
    );
    const expenseValue = rangeExpenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );
    const netProfit = grossProfit - expenseValue;

    const buckets = new Map();
    const bucket = (date) => {
      const key = getBucketKey(toDateKey(date), groupBy);
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          revenue: 0,
          costedRevenue: 0,
          cogs: 0,
          purchases: 0,
          expenses: 0,
          salesCount: 0,
          costedCount: 0,
          uncostedCount: 0,
          uncostedRevenue: 0,
          purchaseCount: 0,
          expenseCount: 0,
        });
      }
      return buckets.get(key);
    };

    completedSales.forEach((sale) => {
      const entry = bucket(sale.createdAt);
      const saleRevenue = Number(sale.grandTotal || 0);
      entry.revenue += saleRevenue;
      entry.salesCount += 1;

      if (saleHasCompleteCost(sale)) {
        entry.costedRevenue += saleRevenue;
        entry.cogs += saleCost(sale);
        entry.costedCount += 1;
      } else {
        entry.uncostedCount += 1;
        entry.uncostedRevenue += saleRevenue;
      }
    });

    rangePurchases.forEach((purchase) => {
      const entry = bucket(purchase.purchaseDate || purchase.createdAt);
      entry.purchases += Number(purchase.grandTotal || 0);
      entry.purchaseCount += 1;
    });

    rangeExpenses.forEach((expense) => {
      const entry = bucket(expense.date);
      entry.expenses += Number(expense.amount || 0);
      entry.expenseCount += 1;
    });

    const trend = [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => {
        const grossProfit = entry.costedRevenue - entry.cogs;

        return {
          ...entry,
          grossProfit,
          netProfit: grossProfit - entry.expenses,
        };
      });

    const sellerMap = new Map();

    completedSales.forEach((sale) => {
      (sale.items || []).forEach((item) => {
        const key = item.medicineId || item.name || "unknown";
        const current = sellerMap.get(key) || {
          key,
          name: item.name || "Unknown medicine",
          quantity: 0,
          revenue: 0,
          cost: 0,
          knownCostQuantity: 0,
          unknownCostQuantity: 0,
        };

        const rawQuantity = Number(item.quantity || 0);
        const quantity = Number.isFinite(rawQuantity) ? rawQuantity : 0;
        const rawLineRevenue =
          item.total !== undefined && item.total !== null && item.total !== ""
            ? Number(item.total)
            : quantity * Number(item.unitPrice || 0);
        const lineRevenue = Number.isFinite(rawLineRevenue) ? rawLineRevenue : 0;
        const hasCost = hasRecordedCost(item.costPrice);

        current.quantity += quantity;
        current.revenue += lineRevenue;

        if (hasCost) {
          current.cost += quantity * Number(item.costPrice);
          current.knownCostQuantity += quantity;
        } else {
          current.unknownCostQuantity += quantity;
        }

        sellerMap.set(key, current);
      });
    });

    const sellerRows = [...sellerMap.values()].map((item) => ({
      ...item,
      profit: item.revenue - item.cost,
      partial: item.unknownCostQuantity > 0,
    }));
    const topSellerRevenue = sellerRows.reduce((sum, item) => sum + item.revenue, 0);
    const sellerRevenueDifference = topSellerRevenue - revenue;

    const topSellers = sellerRows
      .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
      .slice(0, 10);

    const supplierMap = new Map();

    rangePurchases.forEach((purchase) => {
      const key = purchase.supplierId || purchase.supplierName || "unknown";
      const current = supplierMap.get(key) || {
        key,
        name: purchase.supplierName || "Unknown supplier",
        invoices: 0,
        units: 0,
        value: 0,
        lastDate: "",
      };

      current.invoices += 1;
      current.units += saleItemCount(purchase);
      current.value += Number(purchase.grandTotal || 0);

      const date = toDateKey(purchase.purchaseDate || purchase.createdAt);
      if (date > current.lastDate) current.lastDate = date;

      supplierMap.set(key, current);
    });

    const supplierSummary = [...supplierMap.values()].sort((a, b) => b.value - a.value);

    const inventory = {
      records: data.medicines.length,
      units: data.medicines.reduce((sum, medicine) => sum + Number(medicine.quantity || 0), 0),
      costValue: data.medicines.reduce(
        (sum, medicine) => sum + Number(medicine.purchasePrice || 0) * Number(medicine.quantity || 0),
        0
      ),
      retailValue: data.medicines.reduce(
        (sum, medicine) => sum + Number(medicine.salePrice || 0) * Number(medicine.quantity || 0),
        0
      ),
      low: data.medicines
        .filter((medicine) => getStockStatus(medicine.quantity, lowLimit).status === "low")
        .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0)),
      out: data.medicines.filter(
        (medicine) => getStockStatus(medicine.quantity, lowLimit).status === "out"
      ),
      expired: data.medicines
        .filter((medicine) => expiryInfo(medicine.expiry, warningDays).status === "expired")
        .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry))),
      expiring: data.medicines
        .filter((medicine) => expiryInfo(medicine.expiry, warningDays).status === "expiring")
        .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry))),
    };

    const categoryMap = new Map();
    data.medicines.forEach((medicine) => {
      const key = medicine.category || "Uncategorised";
      const current = categoryMap.get(key) || { name: key, units: 0, value: 0 };
      current.units += Number(medicine.quantity || 0);
      current.value += Number(medicine.purchasePrice || 0) * Number(medicine.quantity || 0);
      categoryMap.set(key, current);
    });

    const categories = [...categoryMap.values()].sort((a, b) => b.value - a.value);

    return {
      completedSales,
      rangePurchases,
      rangeExpenses,
      revenue,
      costedRevenue,
      cogs,
      grossProfit,
      excludedRevenue,
      uncostedCount: uncostedSales.length,
      costedCount: costedSales.length,
      purchaseValue,
      expenseValue,
      netProfit,
      trend,
      topSellers,
      topSellerRevenue,
      sellerRevenueDifference,
      supplierSummary,
      inventory,
      categories,
    };
  }, [data, startDate, endDate, groupBy, lowLimit, warningDays]);

  function setPreset(preset) {
    const today = todayISO();

    if (preset === "today") {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === "week") {
      setStartDate(startOfWeekISO());
      setEndDate(today);
    } else if (preset === "month") {
      setStartDate(startOfMonthISO());
      setEndDate(today);
    } else if (preset === "year") {
      setStartDate(startOfYearISO());
      setEndDate(today);
    } else {
      setStartDate("");
      setEndDate("");
    }
  }

  function exportCSV() {
    const rows = [];
    const pad = (values) => [...values, "", "", "", "", "", "", "", "", ""].slice(0, 9);

    rows.push(pad(["PharmaCare Financial Report"]));
    rows.push(pad(["Period", startDate || "All time", "to", endDate || "today"]));
    rows.push(pad(["Grouped by", groupBy]));
    rows.push(pad(["Generated", new Date().toLocaleString("en-GB")]));
    rows.push(pad([]));

    rows.push(pad(["Financial Summary"]));
    rows.push(pad(["Metric", "Value"]));
    rows.push(pad(["Sales Revenue", report.revenue.toFixed(2)]));
    rows.push(pad(["Revenue with recorded cost", report.costedRevenue.toFixed(2)]));
    rows.push(pad(["Cost of Goods Sold", report.cogs.toFixed(2)]));
    rows.push(pad(["Gross Profit", report.grossProfit.toFixed(2)]));
    rows.push(pad(["Operating Expenses", report.expenseValue.toFixed(2)]));
    rows.push(pad(["Net Profit", report.netProfit.toFixed(2)]));
    rows.push(pad(["Purchase Spending", report.purchaseValue.toFixed(2)]));
    rows.push(
      pad([
        "Sales without cost data (excluded from profit)",
        `${report.uncostedCount} invoices / ${report.excludedRevenue.toFixed(2)} revenue`,
      ])
    );
    rows.push(pad([]));

    rows.push(pad(["Period Breakdown"]));
    rows.push(
      pad([
        "Period",
        "Sales Revenue",
        "Revenue with Cost",
        "COGS",
        "Gross Profit",
        "Purchases",
        "Expenses",
        "Net Profit",
        "Uncosted (invoices / revenue)",
      ])
    );
    report.trend.forEach((entry) => {
      rows.push(
        pad([
          prettyBucket(entry.key, groupBy),
          entry.revenue.toFixed(2),
          entry.costedRevenue.toFixed(2),
          entry.cogs.toFixed(2),
          entry.grossProfit.toFixed(2),
          entry.purchases.toFixed(2),
          entry.expenses.toFixed(2),
          entry.netProfit.toFixed(2),
          `${entry.uncostedCount} / ${entry.uncostedRevenue.toFixed(2)}`,
        ])
      );
    });
    rows.push(pad([]));

    rows.push(pad(["Top Sellers"]));
    rows.push(pad(["Medicine", "Units", "Revenue", "Known Cost", "Gross Profit", "Cost Coverage"]));
    report.topSellers.forEach((item) => {
      rows.push(
        pad([
          item.name,
          item.quantity,
          item.revenue.toFixed(2),
          item.cost.toFixed(2),
          item.partial ? "—" : item.profit.toFixed(2),
          item.partial ? "Partial" : "Complete",
        ])
      );
    });
    if (Math.abs(report.sellerRevenueDifference) > 0.005) {
      rows.push(
        pad([
          "All line-item revenue before invoice discounts",
          report.topSellerRevenue.toFixed(2),
        ])
      );
      rows.push(
        pad([
          "Invoice-level discounts, rounding, or adjustments not allocated to medicines",
          Math.abs(report.sellerRevenueDifference).toFixed(2),
        ])
      );
    }
    rows.push(pad([]));

    rows.push(pad(["Supplier Summary"]));
    rows.push(pad(["Supplier", "Invoices", "Units", "Value", "Last Purchase"]));
    report.supplierSummary.forEach((item) => {
      rows.push(
        pad([
          item.name,
          item.invoices,
          item.units,
          item.value.toFixed(2),
          toDisplayDate(item.lastDate),
        ])
      );
    });
    rows.push(pad([]));

    rows.push(pad(["Inventory Snapshot (as of today)"]));
    rows.push(pad(["Records", report.inventory.records]));
    rows.push(pad(["Units in stock", report.inventory.units]));
    rows.push(pad(["Stock cost value", report.inventory.costValue.toFixed(2)]));
    rows.push(pad(["Stock retail value", report.inventory.retailValue.toFixed(2)]));
    rows.push(pad(["Low stock records", report.inventory.low.length]));
    rows.push(pad(["Out of stock records", report.inventory.out.length]));
    rows.push(pad(["Expired records", report.inventory.expired.length]));
    rows.push(pad([`Expiring within ${warningDays} days`, report.inventory.expiring.length]));

    downloadCSV(
      `PharmaCare-Report-${startDate || "all"}-to-${endDate || "today"}.csv`,
      [
        "Section",
        "Field 1",
        "Field 2",
        "Field 3",
        "Field 4",
        "Field 5",
        "Field 6",
        "Field 7",
        "Field 8",
      ],
      rows
    );

    toast.success("Report exported as CSV (Excel compatible).", "Export complete");
  }

  function printReport() {
    window.print();
  }

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Building reports…" />
      </div>
    );
  }

  return (
    <div className="page report-page">
      <PageHeader
        eyebrow="FINANCE"
        title="Reports & Analytics"
        subtitle="Accurate revenue, cost, profit and inventory reporting from your local data."
        actions={
          <>
            <button type="button" className="btn btn-secondary no-print" onClick={exportCSV}>
              <Download size={16} />
              Export CSV
            </button>
            <button type="button" className="btn btn-primary no-print" onClick={printReport}>
              <Printer size={16} />
              Print
            </button>
          </>
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <section className="card report-filter-card no-print">
        <div className="report-presets">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreset("today")}>
            Today
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreset("week")}>
            This Week
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreset("month")}>
            This Month
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreset("year")}>
            This Year
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreset("all")}>
            All Time
          </button>
        </div>

        <div className="report-filter-fields">
          <Field label="From">
            <input
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </Field>
          <Field label="Group sales by">
            <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </Field>
        </div>
      </section>

      <div className="report-heading">
        <h2>Financial Overview</h2>
        <span>
          {startDate || "All time"} → {endDate || "today"}
        </span>
      </div>

      <div className="stat-grid stat-grid-3">
        <StatTile
          icon={TrendingUp}
          tone="green"
          label="Sales Revenue"
          value={formatMoney(report.revenue, settings)}
          hint={`${report.completedSales.length} completed ${
            report.completedSales.length === 1 ? "invoice" : "invoices"
          } · ${formatMoney(report.costedRevenue, settings)} with recorded cost`}
        />
        <StatTile
          icon={Package}
          tone="indigo"
          label="Cost of Goods Sold"
          value={formatMoney(report.cogs, settings)}
          hint={`From cost snapshot on ${report.costedCount} ${
            report.costedCount === 1 ? "invoice" : "invoices"
          }`}
        />
        <StatTile
          icon={BarChart3}
          tone="teal"
          label="Gross Profit"
          value={formatMoney(report.grossProfit, settings)}
          hint={`${report.costedCount} of ${report.completedSales.length} ${
            report.completedSales.length === 1 ? "sale has" : "sales have"
          } cost data`}
        />
        <StatTile
          icon={Wallet}
          tone="orange"
          label="Operating Expenses"
          value={formatMoney(report.expenseValue, settings)}
          hint={`${report.rangeExpenses.length} records dated in this period`}
        />
        <StatTile
          icon={TrendingUp}
          tone={report.netProfit < 0 ? "red" : "green"}
          label="Net Profit"
          value={formatMoney(report.netProfit, settings)}
          hint="Gross profit minus expenses dated in this period"
        />
        <StatTile
          icon={Truck}
          tone="blue"
          label="Purchase Spending"
          value={formatMoney(report.purchaseValue, settings)}
          hint={`${report.rangePurchases.length} purchase ${
            report.rangePurchases.length === 1 ? "invoice" : "invoices"
          }`}
        />
      </div>

      {report.uncostedCount > 0 && (
        <div className="form-alert form-alert-warning">
          {report.uncostedCount} completed sale{report.uncostedCount === 1 ? "" : "s"} in this
          period ({formatMoney(report.excludedRevenue, settings)} revenue){" "}
          {report.uncostedCount === 1 ? "has" : "have"} no recorded cost price and{" "}
          {report.uncostedCount === 1 ? "is" : "are"} excluded from gross and net profit. Revenue
          with recorded cost is{" "}
          {formatMoney(report.costedRevenue, settings)}; Sales Revenue still includes every
          completed sale.
        </div>
      )}

      <div className="report-grid">
        <section className="card report-card-wide">
          <div className="card-head">
            <div>
              <h2>Period Breakdown</h2>
              <p>Same accounting rules as the overview; purchases are shown separately.</p>
            </div>
            <BarChart3 size={18} />
          </div>

          {report.trend.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No activity in this period"
              message="Change the date range or record new transactions."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>{groupBy === "day" ? "Date" : groupBy === "week" ? "Week" : groupBy === "month" ? "Month" : "Year"}</th>
                    <th className="num">Sales Revenue</th>
                    <th className="num">COGS</th>
                    <th className="num">Gross Profit</th>
                    <th className="num">Purchases</th>
                    <th className="num">Expenses</th>
                    <th className="num">Net Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {report.trend.map((entry) => (
                    <tr key={entry.key}>
                      <td>
                        <strong>{prettyBucket(entry.key, groupBy)}</strong>
                        <span className="cell-sub">
                          {entry.salesCount} {entry.salesCount === 1 ? "sale" : "sales"} ·{" "}
                          {entry.purchaseCount}{" "}
                          {entry.purchaseCount === 1 ? "purchase" : "purchases"} ·{" "}
                          {entry.expenseCount}{" "}
                          {entry.expenseCount === 1 ? "expense" : "expenses"}
                          {entry.uncostedCount > 0
                            ? ` · ${entry.uncostedCount} without cost (${formatMoney(
                                entry.uncostedRevenue,
                                settings
                              )})`
                            : ""}
                        </span>
                      </td>
                      <td className="num">
                        {formatMoney(entry.revenue, settings)}
                        {entry.uncostedCount > 0 && (
                          <span className="cell-sub">
                            {formatMoney(entry.costedRevenue, settings)} with cost
                          </span>
                        )}
                      </td>
                      <td className="num">{formatMoney(entry.cogs, settings)}</td>
                      <td className="num">
                        <strong className={entry.grossProfit < 0 ? "text-danger" : "text-success"}>
                          {formatMoney(entry.grossProfit, settings)}
                        </strong>
                      </td>
                      <td className="num">{formatMoney(entry.purchases, settings)}</td>
                      <td className="num">{formatMoney(entry.expenses, settings)}</td>
                      <td className="num">
                        <strong className={entry.netProfit < 0 ? "text-danger" : "text-success"}>
                          {formatMoney(entry.netProfit, settings)}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Top Sellers</h2>
              <p>Highest unit sales; revenue is item-level before invoice discounts.</p>
            </div>
            <TrendingUp size={18} />
          </div>

          {report.topSellers.length === 0 ? (
            <EmptyState icon={Receipt} title="No sales in this period" message="Top sellers appear once sales are recorded." />
          ) : (
            <>
              <div className="report-list">
                {report.topSellers.map((item, index) => (
                  <div className="report-list-row" key={item.key}>
                    <span className="report-rank">{index + 1}</span>
                    <div className="report-list-copy">
                      <strong>{item.name}</strong>
                      <span>
                        {formatInteger(item.quantity)} units ·{" "}
                        {formatMoney(item.revenue, settings)} revenue
                        {item.partial ? " · partial cost" : ""}
                      </span>
                    </div>
                    <strong className={item.profit < 0 ? "text-danger" : "text-success"}>
                      {item.partial ? "—" : formatMoney(item.profit, settings)}
                    </strong>
                  </div>
                ))}
              </div>

              {Math.abs(report.sellerRevenueDifference) > 0.005 && (
                <p className="summary-note">
                  All line-item revenue totals {formatMoney(report.topSellerRevenue, settings)}{" "}
                  before invoice discounts. The{" "}
                  {formatMoney(Math.abs(report.sellerRevenueDifference), settings)} difference from
                  Sales Revenue reflects invoice-level discounts, rounding, or adjustments that are
                  not allocated to individual medicines.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <div className="report-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Supplier Summary</h2>
              <p>Purchases in the selected period.</p>
            </div>
            <Truck size={18} />
          </div>

          {report.supplierSummary.length === 0 ? (
            <EmptyState icon={Truck} title="No purchases in this period" message="Supplier totals appear after purchases are recorded." />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th className="num">Invoices</th>
                    <th className="num">Units</th>
                    <th className="num">Value</th>
                    <th>Last Purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {report.supplierSummary.map((supplier) => (
                    <tr key={supplier.key}>
                      <td>
                        <strong>{supplier.name}</strong>
                      </td>
                      <td className="num">{formatInteger(supplier.invoices)}</td>
                      <td className="num">{formatInteger(supplier.units)}</td>
                      <td className="num">
                        <strong>{formatMoney(supplier.value, settings)}</strong>
                      </td>
                      <td>{supplier.lastDate ? toDisplayDate(supplier.lastDate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Inventory Snapshot</h2>
              <p>Current stock position, independent of the date range.</p>
            </div>
            <Package size={18} />
          </div>

          <div className="summary-rows">
            <div>
              <span>Medicine records</span>
              <strong>{formatInteger(report.inventory.records)}</strong>
            </div>
            <div>
              <span>Total units</span>
              <strong>{formatInteger(report.inventory.units)}</strong>
            </div>
            <div>
              <span>Stock cost value</span>
              <strong>{formatMoney(report.inventory.costValue, settings)}</strong>
            </div>
            <div>
              <span>Stock retail value</span>
              <strong>{formatMoney(report.inventory.retailValue, settings)}</strong>
            </div>
            <div>
              <span>Potential gross margin</span>
              <strong className="text-success">
                {formatMoney(report.inventory.retailValue - report.inventory.costValue, settings)}
              </strong>
            </div>
          </div>
        </section>
      </div>

      <div className="report-grid report-grid-3">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Low & Out of Stock</h2>
              <p>At or below {lowLimit} units.</p>
            </div>
            <AlertTriangle size={18} className="text-amber" />
          </div>

          <div className="report-inline-list">
            <div className="report-inline-head">
              <span>Low stock</span>
              <Badge tone="amber">{report.inventory.low.length}</Badge>
            </div>
            {report.inventory.low.length === 0 ? (
              <p className="inline-empty">No low-stock medicines.</p>
            ) : (
              report.inventory.low.slice(0, 6).map((medicine) => (
                <div className="report-inline-row" key={medicine.id}>
                  <div>
                    <strong>{medicine.name}</strong>
                    <span>Batch {medicine.batch || "—"}</span>
                  </div>
                  <Badge tone="amber">{medicine.quantity} left</Badge>
                </div>
              ))
            )}

            <div className="report-inline-head">
              <span>Out of stock</span>
              <Badge tone="red">{report.inventory.out.length}</Badge>
            </div>
            {report.inventory.out.length === 0 ? (
              <p className="inline-empty">No out-of-stock medicines.</p>
            ) : (
              report.inventory.out.slice(0, 6).map((medicine) => (
                <div className="report-inline-row" key={medicine.id}>
                  <div>
                    <strong>{medicine.name}</strong>
                    <span>Batch {medicine.batch || "—"}</span>
                  </div>
                  <Badge tone="red">0 left</Badge>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Expired</h2>
              <p>Past expiry date. Remove from saleable stock.</p>
            </div>
            <CalendarX size={18} className="text-danger" />
          </div>

          <div className="report-inline-list">
            <div className="report-inline-head">
              <span>Expired records</span>
              <Badge tone="red">{report.inventory.expired.length}</Badge>
            </div>
            {report.inventory.expired.length === 0 ? (
              <p className="inline-empty">No expired medicines recorded.</p>
            ) : (
              report.inventory.expired.slice(0, 8).map((medicine) => (
                <div className="report-inline-row" key={medicine.id}>
                  <div>
                    <strong>{medicine.name}</strong>
                    <span>Batch {medicine.batch || "—"}</span>
                  </div>
                  <Badge tone="red">{toDisplayDate(medicine.expiry)}</Badge>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Expiring Soon</h2>
              <p>Within the next {warningDays} days.</p>
            </div>
            <CalendarClock size={18} className="text-orange" />
          </div>

          <div className="report-inline-list">
            <div className="report-inline-head">
              <span>Expiring medicines</span>
              <Badge tone="orange">{report.inventory.expiring.length}</Badge>
            </div>
            {report.inventory.expiring.length === 0 ? (
              <p className="inline-empty">No medicines expiring in this window.</p>
            ) : (
              report.inventory.expiring.slice(0, 8).map((medicine) => {
                const info = expiryInfo(medicine.expiry, warningDays);
                return (
                  <div className="report-inline-row" key={medicine.id}>
                    <div>
                      <strong>{medicine.name}</strong>
                      <span>Batch {medicine.batch || "—"}</span>
                    </div>
                    <Badge tone="orange">{info.label}</Badge>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {report.categories.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Inventory by Category</h2>
              <p>Current stock cost value by category.</p>
            </div>
            <Package size={18} />
          </div>

          <div className="category-bars">
            {report.categories.slice(0, 8).map((category) => {
              const max = Math.max(...report.categories.map((item) => item.value), 1);
              const width = Math.max(3, Math.round((category.value / max) * 100));

              return (
                <div className="category-bar-row" key={category.name}>
                  <div className="category-bar-copy">
                    <strong>{category.name}</strong>
                    <span>{formatInteger(category.units)} units</span>
                  </div>
                  <div className="category-bar-track">
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <strong className="category-bar-value">
                    {formatMoney(category.value, settings)}
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <p className="page-footnote">
        Gross profit = revenue from completed sales with recorded cost − cost of goods sold. Sales
        without recorded cost are excluded from gross and net profit but remain in Sales Revenue.
        Net profit = gross profit − operating expenses dated in the selected period. Purchase
        spending is shown separately and is not deducted from profit because COGS already reflects
        inventory sold. Inventory snapshot is current, not limited to the selected period.
      </p>
    </div>
  );
}
