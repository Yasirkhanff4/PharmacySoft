import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarX,
  ChartNoAxesCombined,
  CircleDollarSign,
  Clock3,
  Package,
  Pill,
  Plus,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import { db } from "../database/db";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../hooks/useSettings";
import {
  Badge,
  EmptyState,
  LoadingBlock,
  PageHeader,
  StatTile,
} from "../components/ui/primitives";
import {
  addDaysISO,
  expiryInfo,
  formatInteger,
  formatMoney,
  isCompletedSale,
  saleCost,
  saleHasCompleteCost,
  saleItemCount,
  startOfMonthISO,
  toDisplayDate,
  toDisplayDateTime,
  todayISO,
} from "../lib/format";

function sumBy(list, selector) {
  return list.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const settings = useSettings();
  const { user, can } = useAuth();

  const [data, setData] = useState({
    medicines: [],
    sales: [],
    purchases: [],
    expenses: [],
    customers: [],
    suppliers: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [medicines, sales, purchases, expenses, customers, suppliers] =
          await Promise.all([
            db.medicines.toArray(),
            db.sales.toArray(),
            db.purchases.toArray(),
            db.expenses.toArray(),
            db.customers.toArray(),
            db.suppliers.toArray(),
          ]);

        if (!active) return;

        setData({ medicines, sales, purchases, expenses, customers, suppliers });
      } catch (loadError) {
        console.error("Dashboard loading failed:", loadError);
        if (active) setError("Unable to load dashboard data. Please refresh the page.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  const model = useMemo(() => {
    const today = todayISO();
    const monthStart = startOfMonthISO();
    const warningDays = Number(settings.expiryWarningDays) || 30;
    const lowLimit = Number(settings.lowStockLimit) || 10;
    const soonLimit = addDaysISO(today, warningDays);

    const completedSales = data.sales.filter(isCompletedSale);
    const todaySales = completedSales.filter(
      (sale) => String(sale.createdAt || "").slice(0, 10) === today
    );
    const monthSales = completedSales.filter(
      (sale) => String(sale.createdAt || "").slice(0, 10) >= monthStart
    );

    const totalRevenue = sumBy(completedSales, (sale) => sale.grandTotal);
    const todayRevenue = sumBy(todaySales, (sale) => sale.grandTotal);
    const monthRevenue = sumBy(monthSales, (sale) => sale.grandTotal);

    const costedSales = completedSales.filter(saleHasCompleteCost);
    const monthCostedSales = monthSales.filter(saleHasCompleteCost);
    const grossProfit = sumBy(costedSales, (sale) => Number(sale.grandTotal || 0) - saleCost(sale));
    const monthGrossProfit = sumBy(
      monthCostedSales,
      (sale) => Number(sale.grandTotal || 0) - saleCost(sale)
    );

    const totalExpenses = sumBy(data.expenses, (expense) => expense.amount);
    const monthExpenses = sumBy(
      data.expenses.filter((expense) => String(expense.date || "").startsWith(monthStart.slice(0, 7))),
      (expense) => expense.amount
    );

    const excludedSales = completedSales.filter((sale) => !saleHasCompleteCost(sale));
    const excludedRevenue = sumBy(excludedSales, (sale) => sale.grandTotal);

    const lowStock = data.medicines
      .filter((medicine) => Number(medicine.quantity || 0) <= lowLimit)
      .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));

    const expired = data.medicines
      .filter((medicine) => {
        const info = expiryInfo(medicine.expiry, warningDays);
        return info.status === "expired";
      })
      .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));

    const expiringSoon = data.medicines
      .filter((medicine) => {
        const info = expiryInfo(medicine.expiry, warningDays);
        return info.status === "expiring" && String(medicine.expiry) <= soonLimit;
      })
      .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));

    const inventoryPurchaseValue = sumBy(
      data.medicines,
      (medicine) => Number(medicine.purchasePrice || 0) * Number(medicine.quantity || 0)
    );
    const inventoryRetailValue = sumBy(
      data.medicines,
      (medicine) => Number(medicine.salePrice || 0) * Number(medicine.quantity || 0)
    );
    const totalQuantity = sumBy(data.medicines, (medicine) => medicine.quantity);

    const completedPurchases = data.purchases.filter(
      (purchase) => purchase.status !== "cancelled"
    );
    const todayPurchases = completedPurchases.filter(
      (purchase) => (purchase.purchaseDate || String(purchase.createdAt || "").slice(0, 10)) === today
    );
    const monthPurchases = completedPurchases.filter(
      (purchase) => (purchase.purchaseDate || String(purchase.createdAt || "").slice(0, 10)) >= monthStart
    );
    const totalPurchaseValue = sumBy(completedPurchases, (purchase) => purchase.grandTotal);
    const monthPurchaseValue = sumBy(monthPurchases, (purchase) => purchase.grandTotal);

    const categoryMap = new Map();
    data.medicines.forEach((medicine) => {
      const category = medicine.category || "Uncategorised";
      const current = categoryMap.get(category) || { name: category, items: 0, quantity: 0, value: 0 };
      current.items += 1;
      current.quantity += Number(medicine.quantity || 0);
      current.value += Number(medicine.purchasePrice || 0) * Number(medicine.quantity || 0);
      categoryMap.set(category, current);
    });

    const categories = [...categoryMap.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    const recentSales = [...data.sales]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 6);

    const recentPurchases = [...data.purchases]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 6);

    return {
      today,
      completedSales,
      todaySales,
      monthSales,
      totalRevenue,
      todayRevenue,
      monthRevenue,
      todayCount: todaySales.length,
      monthCount: monthSales.length,
      coveredSales: costedSales.length,
      excludedSales,
      excludedRevenue,
      grossProfit,
      monthGrossProfit,
      totalExpenses,
      monthExpenses,
      netProfit: grossProfit - totalExpenses,
      monthNetProfit: monthGrossProfit - monthExpenses,
      lowStock,
      expired,
      expiringSoon,
      inventoryPurchaseValue,
      inventoryRetailValue,
      totalQuantity,
      completedPurchases,
      todayPurchases,
      monthPurchases,
      totalPurchaseValue,
      monthPurchaseValue,
      categories,
      recentSales,
      recentPurchases,
      lowLimit,
      warningDays,
    };
  }, [data, settings]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    const prefix = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const firstName = (user?.name || "there").split(" ")[0];
    return `${prefix}, ${firstName}`;
  }, [user]);

  if (loading) {
    return (
      <div className="page">
        <LoadingBlock label="Loading your pharmacy dashboard…" />
      </div>
    );
  }

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="PHARMACY OVERVIEW"
        title={greeting}
        subtitle="Live figures from your local pharmacy database."
        actions={
          <>
            {can("medicines.manage") && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate("/medicines", { state: { openAdd: true } })}
              >
                <Plus size={16} />
                Add Medicine
              </button>
            )}
            {can("pos.use") && (
              <button type="button" className="btn btn-primary" onClick={() => navigate("/pos")}>
                <ShoppingCart size={16} />
                New Sale
              </button>
            )}
          </>
        }
      />

      {error && <div className="form-alert form-alert-error">{error}</div>}

      <div className="dash-quickbar">
        <div className="dash-quickbar-message">
          <Clock3 size={16} />
          <span>
            {model.todayCount === 0
              ? "No sales recorded today yet."
              : `${model.todayCount} sale${model.todayCount === 1 ? "" : "s"} recorded today.`}
          </span>
        </div>

        <div className="dash-quick-actions">
          {can("pos.use") && (
            <button type="button" onClick={() => navigate("/pos")}>
              <ShoppingCart size={15} /> POS
            </button>
          )}
          {can("purchases.manage") && (
            <button type="button" onClick={() => navigate("/purchases")}>
              <Truck size={15} /> Purchase
            </button>
          )}
          {can("reports.view") && (
            <button type="button" onClick={() => navigate("/reports")}>
              <ChartNoAxesCombined size={15} /> Reports
            </button>
          )}
          {can("settings.manage") && (
            <button type="button" onClick={() => navigate("/settings", { state: { tab: "data" } })}>
              <Package size={15} /> Backup
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid stat-grid-4">
        <StatTile
          icon={Pill}
          tone="blue"
          label="Total Medicines"
          value={formatInteger(data.medicines.length)}
          hint="Distinct medicines in inventory"
        />
        <StatTile
          icon={ShoppingCart}
          tone="green"
          label="Today's Sales"
          value={formatMoney(model.todayRevenue, settings)}
          hint={`${model.todayCount} invoice${model.todayCount === 1 ? "" : "s"} today`}
        />
        <StatTile
          icon={TrendingUp}
          tone="indigo"
          label="Total Sales"
          value={formatMoney(model.totalRevenue, settings)}
          hint={`${model.completedSales.length} completed invoices`}
        />
        <StatTile
          icon={AlertTriangle}
          tone="amber"
          label="Low Stock"
          value={formatInteger(model.lowStock.length)}
          hint={`At or below ${model.lowLimit} units`}
        />
        <StatTile
          icon={CalendarX}
          tone="red"
          label="Expired Medicines"
          value={formatInteger(model.expired.length)}
          hint="Past their expiry date"
        />
        <StatTile
          icon={CalendarClock}
          tone="orange"
          label="Expiring Soon"
          value={formatInteger(model.expiringSoon.length)}
          hint={`Within ${model.warningDays} days`}
        />
        <StatTile
          icon={Package}
          tone="slate"
          label="Inventory Cost Value"
          value={formatMoney(model.inventoryPurchaseValue, settings)}
          hint={`Retail value ${formatMoney(model.inventoryRetailValue, settings)}`}
        />
        <StatTile
          icon={CircleDollarSign}
          tone="teal"
          label="Total Stock Quantity"
          value={formatInteger(model.totalQuantity)}
          hint={`${data.medicines.length} medicine records`}
        />
      </div>

      <div className="dashboard-summary-grid">
        <section className="card dashboard-summary-card">
          <div className="card-head">
            <div>
              <h2>Revenue Summary</h2>
              <p>Completed sales only.</p>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="summary-rows">
            <div>
              <span>Today</span>
              <strong>{formatMoney(model.todayRevenue, settings)}</strong>
            </div>
            <div>
              <span>This month</span>
              <strong>{formatMoney(model.monthRevenue, settings)}</strong>
            </div>
            <div>
              <span>All time</span>
              <strong>{formatMoney(model.totalRevenue, settings)}</strong>
            </div>
          </div>
        </section>

        <section className="card dashboard-summary-card">
          <div className="card-head">
            <div>
              <h2>Profit Summary</h2>
              <p>Uses cost captured at checkout.</p>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="summary-rows">
            <div>
              <span>Gross profit (month)</span>
              <strong className={model.monthGrossProfit < 0 ? "text-danger" : "text-success"}>
                {formatMoney(model.monthGrossProfit, settings)}
              </strong>
            </div>
            <div>
              <span>Expenses (month)</span>
              <strong>{formatMoney(model.monthExpenses, settings)}</strong>
            </div>
            <div>
              <span>Net profit (month)</span>
              <strong className={model.monthNetProfit < 0 ? "text-danger" : "text-success"}>
                {formatMoney(model.monthNetProfit, settings)}
              </strong>
            </div>
          </div>
          {model.excludedSales.length > 0 && (
            <p className="summary-note summary-note-warning">
              <AlertTriangle size={13} />
              <span>
                Cost data is missing on {model.excludedSales.length} of{" "}
                {model.completedSales.length} completed invoice
                {model.completedSales.length === 1 ? "" : "s"}. Their{" "}
                {formatMoney(model.excludedRevenue, settings)} revenue is excluded from gross
                profit.
              </span>
            </p>
          )}
        </section>

        <section className="card dashboard-summary-card">
          <div className="card-head">
            <div>
              <h2>Purchase Summary</h2>
              <p>Supplier purchase invoices.</p>
            </div>
            <Truck size={18} />
          </div>
          <div className="summary-rows">
            <div>
              <span>Today</span>
              <strong>{formatMoney(sumBy(model.todayPurchases, (p) => p.grandTotal), settings)}</strong>
            </div>
            <div>
              <span>This month</span>
              <strong>{formatMoney(model.monthPurchaseValue, settings)}</strong>
            </div>
            <div>
              <span>All time</span>
              <strong>{formatMoney(model.totalPurchaseValue, settings)}</strong>
            </div>
          </div>
        </section>

        <section className="card dashboard-summary-card">
          <div className="card-head">
            <div>
              <h2>Expense Summary</h2>
              <p>Operating expenses recorded.</p>
            </div>
            <Wallet size={18} />
          </div>
          <div className="summary-rows">
            <div>
              <span>This month</span>
              <strong>{formatMoney(model.monthExpenses, settings)}</strong>
            </div>
            <div>
              <span>All time</span>
              <strong>{formatMoney(model.totalExpenses, settings)}</strong>
            </div>
            <div>
              <span>Net profit (all time)</span>
              <strong className={model.netProfit < 0 ? "text-danger" : "text-success"}>
                {formatMoney(model.netProfit, settings)}
              </strong>
            </div>
          </div>
        </section>
      </div>

      <div className="dashboard-main-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Inventory Alerts</h2>
              <p>Stock and expiry issues requiring attention.</p>
            </div>
            <AlertTriangle size={18} className="text-amber" />
          </div>

          <div className="alert-groups">
            <div className="alert-group alert-group-low">
              <div className="alert-group-head">
                <div>
                  <strong>Low stock</strong>
                  <span>At or below {model.lowLimit} units</span>
                </div>
                <Badge tone="amber">{model.lowStock.length}</Badge>
              </div>
              {model.lowStock.length === 0 ? (
                <p className="inline-empty">All medicines are above the low-stock threshold.</p>
              ) : (
                model.lowStock.slice(0, 5).map((medicine) => (
                  <div className="alert-line" key={medicine.id}>
                    <div>
                      <strong>{medicine.name}</strong>
                      <span>Batch {medicine.batch || "—"}</span>
                    </div>
                    <Badge tone={Number(medicine.quantity) <= 0 ? "red" : "amber"} dot>
                      {Number(medicine.quantity) <= 0
                        ? "Out of stock"
                        : `${medicine.quantity} left`}
                    </Badge>
                  </div>
                ))
              )}
              {model.lowStock.length > 5 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => navigate("/medicines", { state: { stockStatus: "low" } })}
                >
                  View all {model.lowStock.length} low-stock medicines <ArrowRight size={14} />
                </button>
              )}
            </div>

            <div className="alert-group alert-group-expired">
              <div className="alert-group-head">
                <div>
                  <strong>Expired</strong>
                  <span>Remove from saleable stock</span>
                </div>
                <Badge tone="red">{model.expired.length}</Badge>
              </div>
              {model.expired.length === 0 ? (
                <p className="inline-empty">No expired medicines recorded.</p>
              ) : (
                model.expired.slice(0, 5).map((medicine) => (
                  <div className="alert-line" key={medicine.id}>
                    <div>
                      <strong>{medicine.name}</strong>
                      <span>Batch {medicine.batch || "—"}</span>
                    </div>
                    <Badge tone="red" dot>
                      {toDisplayDate(medicine.expiry)}
                    </Badge>
                  </div>
                ))
              )}
            </div>

            <div className="alert-group alert-group-expiring">
              <div className="alert-group-head">
                <div>
                  <strong>Expiring soon</strong>
                  <span>Within the next {model.warningDays} days</span>
                </div>
                <Badge tone="orange">{model.expiringSoon.length}</Badge>
              </div>
              {model.expiringSoon.length === 0 ? (
                <p className="inline-empty">No medicines expiring in this window.</p>
              ) : (
                model.expiringSoon.slice(0, 5).map((medicine) => {
                  const info = expiryInfo(medicine.expiry, model.warningDays);
                  return (
                    <div className="alert-line" key={medicine.id}>
                      <div>
                        <strong>{medicine.name}</strong>
                        <span>Batch {medicine.batch || "—"}</span>
                      </div>
                      <Badge tone="orange" dot>
                        {info.label}
                      </Badge>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Inventory Overview</h2>
              <p>Top categories by stock cost value.</p>
            </div>
            <Package size={18} />
          </div>

          {model.categories.length === 0 ? (
            <EmptyState
              icon={Pill}
              title="No inventory yet"
              message="Add medicines to see category breakdowns."
              action={
                can("medicines.manage") ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => navigate("/medicines")}
                  >
                    Add Medicine
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="category-bars">
              {model.categories.map((category) => {
                const max = Math.max(...model.categories.map((item) => item.value), 1);
                const width = Math.max(4, Math.round((category.value / max) * 100));

                return (
                  <div className="category-bar-row" key={category.name}>
                    <div className="category-bar-copy">
                      <strong>{category.name}</strong>
                      <span>
                        {category.items} item{category.items === 1 ? "" : "s"} ·{" "}
                        {formatInteger(category.quantity)} units
                      </span>
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
          )}
        </section>
      </div>

      <div className="dashboard-lists-grid">
        <section className="card">
          <div className="card-head card-head-action">
            <div>
              <h2>Recent Sales</h2>
              <p>Latest completed and cancelled invoices.</p>
            </div>
            {can("sales.view") && (
              <button type="button" className="link-button" onClick={() => navigate("/sales-history")}>
                View all <ArrowRight size={14} />
              </button>
            )}
          </div>

          {model.recentSales.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No sales yet"
              message="Completed sales will appear here."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Customer</th>
                    <th>Date</th>
                    <th className="num">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {model.recentSales.map((sale) => (
                    <tr key={sale.id}>
                      <td>
                        <strong>{sale.invoiceNumber || "—"}</strong>
                      </td>
                      <td>{sale.customerName || "Walk-in Customer"}</td>
                      <td>{toDisplayDateTime(sale.createdAt)}</td>
                      <td className="num">{formatMoney(sale.grandTotal, settings)}</td>
                      <td>
                        <Badge tone={isCompletedSale(sale) ? "green" : "red"} dot>
                          {isCompletedSale(sale) ? "Completed" : "Cancelled"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head card-head-action">
            <div>
              <h2>Recent Purchases</h2>
              <p>Latest supplier purchase invoices.</p>
            </div>
            {can("purchases.view") && (
              <button type="button" className="link-button" onClick={() => navigate("/purchases")}>
                View all <ArrowRight size={14} />
              </button>
            )}
          </div>

          {model.recentPurchases.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No purchases yet"
              message="Supplier purchases will appear here."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Supplier</th>
                    <th>Date</th>
                    <th className="num">Items</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {model.recentPurchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td>
                        <strong>{purchase.invoiceNumber || "—"}</strong>
                      </td>
                      <td>{purchase.supplierName || "—"}</td>
                      <td>{toDisplayDate(purchase.purchaseDate || purchase.createdAt)}</td>
                      <td className="num">{saleItemCount(purchase)}</td>
                      <td className="num">{formatMoney(purchase.grandTotal, settings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="dashboard-footnote">
        <span>
          Profit is calculated only from sales that contain a recorded cost price.{" "}
          {model.coveredSales} of {model.completedSales.length} completed sales have cost data.
        </span>
      </div>
    </div>
  );
}
