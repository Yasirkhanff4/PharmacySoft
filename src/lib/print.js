import { escapeHTML, formatMoney, toDisplayDate, toDisplayDateTime } from "./format";

function safeLogo(logo) {
  if (typeof logo === "string" && logo.startsWith("data:image/")) {
    return escapeHTML(logo);
  }
  return "";
}

function openPrintWindow(title, html) {
  const printWindow = window.open("", "_blank", "width=980,height=760");

  if (!printWindow) return false;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  return true;
}

const documentStyle = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 34px; color: #172033; font-family: "Segoe UI", Arial, sans-serif; font-size: 13px; }
  .brand { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #172033; padding-bottom: 16px; }
  .brand img { width: 58px; height: 58px; object-fit: contain; border-radius: 8px; }
  .brand h1 { margin: 0 0 4px; font-size: 23px; }
  .brand p { margin: 2px 0; color: #526077; font-size: 12px; }
  .doc-title { margin: 20px 0 4px; font-size: 16px; text-transform: uppercase; letter-spacing: 1.4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 18px 0; padding: 14px 0; border-top: 1px dashed #9aa7b8; border-bottom: 1px dashed #9aa7b8; }
  .meta p { margin: 0; }
  .meta span { color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #f1f5f9; color: #334155; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  th, td { padding: 9px 10px; border-bottom: 1px solid #dde4ee; vertical-align: top; }
  td { font-size: 12px; }
  .right { text-align: right; }
  .totals { width: 330px; margin: 18px 0 0 auto; }
  .totals p { display: flex; justify-content: space-between; margin: 0; padding: 6px 0; color: #526077; }
  .totals h2 { display: flex; justify-content: space-between; margin: 6px 0 0; padding: 12px 0 0; border-top: 2px solid #172033; font-size: 18px; }
  .note { margin-top: 22px; padding: 12px 14px; background: #f8fafc; border-radius: 7px; color: #526077; font-size: 12px; }
  .foot { margin-top: 28px; padding-top: 14px; border-top: 1px dashed #9aa7b8; text-align: center; color: #64748b; font-size: 12px; }
  .cancelled { margin: 14px 0; padding: 9px; border: 2px solid #dc2626; color: #dc2626; text-align: center; font-weight: 800; letter-spacing: 2px; }
  @media print { body { padding: 0; } @page { margin: 12mm; } }
`;

export function printSaleInvoice(sale, settings, logo) {
  const pharmacyName = escapeHTML(settings?.pharmacyName || "PharmaCare");
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const itemRows = items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>
            <strong>${escapeHTML(item.name || "Medicine")}</strong>
            <div style="color:#64748b;font-size:11px;margin-top:3px;">
              Batch: ${escapeHTML(item.batch || "—")} &nbsp;|&nbsp; Expiry: ${escapeHTML(
                toDisplayDate(item.expiry)
              )}
            </div>
          </td>
          <td class="right">${Number(item.quantity || 0)}</td>
          <td class="right">${escapeHTML(formatMoney(item.unitPrice, settings))}</td>
          <td class="right">${escapeHTML(
            formatMoney(
              item.total ?? Number(item.unitPrice || 0) * Number(item.quantity || 0),
              settings
            )
          )}</td>
        </tr>`
    )
    .join("");

  const logoSrc = safeLogo(logo);
  const cancelled = (sale?.status || "completed") === "cancelled";
  const amountPaid = Number(sale?.amountPaid);
  const hasAmountPaid =
    sale?.amountPaid !== undefined &&
    sale?.amountPaid !== null &&
    sale?.amountPaid !== "" &&
    Number.isFinite(amountPaid);
  const changeGiven = Number(sale?.changeGiven) || 0;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHTML(sale?.invoiceNumber || "Sales Invoice")}</title>
  <style>${documentStyle}</style>
</head>
<body>
  <div class="brand">
    ${logoSrc ? `<img src="${logoSrc}" alt="" />` : ""}
    <div>
      <h1>${pharmacyName}</h1>
      ${settings?.address ? `<p>${escapeHTML(settings.address)}</p>` : ""}
      ${settings?.phone ? `<p>Phone: ${escapeHTML(settings.phone)}</p>` : ""}
      ${settings?.email ? `<p>Email: ${escapeHTML(settings.email)}</p>` : ""}
    </div>
  </div>

  <h2 class="doc-title">Sales Invoice</h2>
  ${cancelled ? '<div class="cancelled">CANCELLED INVOICE</div>' : ""}

  <div class="meta">
    <p><span>Invoice:</span> <strong>${escapeHTML(sale?.invoiceNumber || "—")}</strong></p>
    <p><span>Date:</span> ${escapeHTML(toDisplayDateTime(sale?.createdAt))}</p>
    <p><span>Customer:</span> ${escapeHTML(sale?.customerName || "Walk-in Customer")}</p>
    <p><span>Phone:</span> ${escapeHTML(sale?.customerPhone || "—")}</p>
    <p><span>Payment:</span> ${escapeHTML(sale?.paymentMethod || "—")}</p>
    <p><span>Served by:</span> ${escapeHTML(sale?.cashier?.name || sale?.cashierName || "—")}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Medicine</th>
        <th class="right">Qty</th>
        <th class="right">Unit Price</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows || '<tr><td colspan="5">No items</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <p><span>Subtotal</span><strong>${escapeHTML(formatMoney(sale?.subtotal, settings))}</strong></p>
    <p><span>Discount</span><strong>${escapeHTML(formatMoney(sale?.discount, settings))}</strong></p>
    <h2><span>Grand Total</span><span>${escapeHTML(formatMoney(sale?.grandTotal, settings))}</span></h2>
    ${
      hasAmountPaid
        ? `<p><span>Amount Paid</span><strong>${escapeHTML(
            formatMoney(amountPaid, settings)
          )}</strong></p>
           <p><span>Change Returned</span><strong>${escapeHTML(
             formatMoney(changeGiven, settings)
           )}</strong></p>`
        : ""
    }
  </div>

  ${
    sale?.notes
      ? `<div class="note"><strong>Notes:</strong> ${escapeHTML(sale.notes)}</div>`
      : ""
  }

  <div class="foot">${escapeHTML(settings?.invoiceFooter || "Thank you for your visit!")}</div>

  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;

  return openPrintWindow(sale?.invoiceNumber || "Sales Invoice", html);
}

export function printPurchaseInvoice(purchase, settings, logo) {
  const pharmacyName = escapeHTML(settings?.pharmacyName || "PharmaCare");
  const items = Array.isArray(purchase?.items) ? purchase.items : [];
  const itemRows = items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>
            <strong>${escapeHTML(item.name || "Medicine")}</strong>
            <div style="color:#64748b;font-size:11px;margin-top:3px;">
              Batch: ${escapeHTML(item.batch || "—")}
            </div>
          </td>
          <td class="right">${Number(item.quantity || 0)}</td>
          <td class="right">${escapeHTML(formatMoney(item.purchasePrice, settings))}</td>
          <td class="right">${escapeHTML(formatMoney(item.total, settings))}</td>
        </tr>`
    )
    .join("");

  const logoSrc = safeLogo(logo);

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHTML(purchase?.invoiceNumber || "Purchase Invoice")}</title>
  <style>${documentStyle}</style>
</head>
<body>
  <div class="brand">
    ${logoSrc ? `<img src="${logoSrc}" alt="" />` : ""}
    <div>
      <h1>${pharmacyName}</h1>
      ${settings?.address ? `<p>${escapeHTML(settings.address)}</p>` : ""}
      ${settings?.phone ? `<p>Phone: ${escapeHTML(settings.phone)}</p>` : ""}
      ${settings?.email ? `<p>Email: ${escapeHTML(settings.email)}</p>` : ""}
    </div>
  </div>

  <h2 class="doc-title">Purchase Invoice</h2>

  <div class="meta">
    <p><span>Invoice:</span> <strong>${escapeHTML(purchase?.invoiceNumber || "—")}</strong></p>
    <p><span>Purchase Date:</span> ${escapeHTML(toDisplayDate(purchase?.purchaseDate))}</p>
    <p><span>Supplier:</span> ${escapeHTML(purchase?.supplierName || "—")}</p>
    <p><span>Supplier Phone:</span> ${escapeHTML(purchase?.supplierPhone || "—")}</p>
    <p><span>Recorded:</span> ${escapeHTML(toDisplayDateTime(purchase?.createdAt))}</p>
    <p><span>Status:</span> ${escapeHTML(purchase?.status || "completed")}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Medicine</th>
        <th class="right">Qty</th>
        <th class="right">Purchase Price</th>
        <th class="right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows || '<tr><td colspan="5">No items</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <h2><span>Grand Total</span><span>${escapeHTML(formatMoney(purchase?.grandTotal, settings))}</span></h2>
  </div>

  ${
    purchase?.notes
      ? `<div class="note"><strong>Notes:</strong> ${escapeHTML(purchase.notes)}</div>`
      : ""
  }

  <div class="foot">Purchase invoice generated by PharmaCare</div>

  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body>
</html>`;

  return openPrintWindow(purchase?.invoiceNumber || "Purchase Invoice", html);
}
