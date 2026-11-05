import { formatMoney, toDisplayDate, toDisplayDateTime } from "../lib/format";

export default function InvoiceView({ sale, settings, logo }) {
  if (!sale) return null;

  const cancelled = (sale.status || "completed") === "cancelled";
  const items = Array.isArray(sale.items) ? sale.items : [];
  const amountPaid = Number(sale.amountPaid);
  const hasAmountPaid =
    sale.amountPaid !== undefined &&
    sale.amountPaid !== null &&
    sale.amountPaid !== "" &&
    Number.isFinite(amountPaid);
  const changeGiven = Number(sale.changeGiven) || 0;

  return (
    <div className="invoice-print-area">
      <div className="invoice-brand">
        {logo ? <img src={logo} alt="Pharmacy logo" className="invoice-logo" /> : null}
        <div>
          <h1>{settings.pharmacyName || "PharmaCare"}</h1>
          {settings.address && <p>{settings.address}</p>}
          {settings.phone && <p>Phone: {settings.phone}</p>}
          {settings.email && <p>Email: {settings.email}</p>}
        </div>
      </div>

      <div className="invoice-title-row">
        <div>
          <span className="invoice-kicker">SALES INVOICE</span>
          <h2>{sale.invoiceNumber || "Invoice"}</h2>
        </div>
        <div className="invoice-meta-right">
          <p>{toDisplayDateTime(sale.createdAt)}</p>
          <p>{sale.paymentMethod || "—"}</p>
        </div>
      </div>

      {cancelled && <div className="invoice-cancelled">CANCELLED INVOICE</div>}

      <div className="invoice-meta">
        <p>
          <span>Customer</span>
          <strong>{sale.customerName || "Walk-in Customer"}</strong>
        </p>
        <p>
          <span>Phone</span>
          <strong>{sale.customerPhone || "—"}</strong>
        </p>
        <p>
          <span>Served by</span>
          <strong>{sale.cashier?.name || sale.cashierName || "—"}</strong>
        </p>
        <p>
          <span>Items</span>
          <strong>{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)}</strong>
        </p>
      </div>

      <div className="table-wrap invoice-table-wrap">
        <table className="data-table invoice-table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Batch</th>
              <th>Expiry</th>
              <th className="num">Qty</th>
              <th className="num">Unit Price</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.medicineId || item.name}-${index}`}>
                <td>
                  <strong>{item.name || "Medicine"}</strong>
                </td>
                <td>{item.batch || "—"}</td>
                <td>{toDisplayDate(item.expiry)}</td>
                <td className="num">{item.quantity || 0}</td>
                <td className="num">{formatMoney(item.unitPrice, settings)}</td>
                <td className="num">
                  {formatMoney(
                    item.total ?? Number(item.unitPrice || 0) * Number(item.quantity || 0),
                    settings
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan="6" className="table-empty">
                  No items recorded on this invoice.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="invoice-summary">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(sale.subtotal, settings)}</strong>
        </div>
        <div>
          <span>Discount</span>
          <strong>{formatMoney(sale.discount, settings)}</strong>
        </div>
        <div className="invoice-grand">
          <span>Grand Total</span>
          <strong>{formatMoney(sale.grandTotal, settings)}</strong>
        </div>
        {hasAmountPaid && (
          <>
            <div>
              <span>Amount Paid</span>
              <strong>{formatMoney(amountPaid, settings)}</strong>
            </div>
            <div>
              <span>Change Returned</span>
              <strong>{formatMoney(changeGiven, settings)}</strong>
            </div>
          </>
        )}
      </div>

      {sale.notes && <p className="invoice-note">{sale.notes}</p>}

      <div className="invoice-foot">
        {settings.invoiceFooter || "Thank you for your visit!"}
      </div>
    </div>
  );
}
