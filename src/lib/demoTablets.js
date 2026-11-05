import { normalizeKey, todayISO } from "./format";

/**
 * Fictional demonstration inventory.
 *
 * Brand and generic names are real-world examples. Manufacturer names are the
 * commonly documented brand owners and are included only for demonstration
 * realism; they are not a claim about local registration or supply.
 * Batch numbers, barcodes, prices, expiries and supplier links are demo data.
 */
export const DEMO_TABLET_SET_ID = "tablet-demo-v1";
export const DEMO_TABLET_SET_LABEL = "50 tablet demo inventory";
export const DEMO_TABLET_SOURCE = "DEMONSTRATION DATA — not for dispensing";

const DEMO_TABLET_ROWS = [
  {
    brandName: "Panadol",
    genericName: "Paracetamol",
    category: "Analgesic",
    strength: "500mg",
    company: "GSK",
    expiry: "2028-06-30",
    purchasePrice: 85,
    salePrice: 110,
    quantity: 140,
  },
  {
    brandName: "Brufen",
    genericName: "Ibuprofen",
    category: "Anti-inflammatory",
    strength: "400mg",
    company: "Abbott",
    expiry: "2028-03-31",
    purchasePrice: 120,
    salePrice: 150,
    quantity: 96,
  },
  {
    brandName: "Ponstan",
    genericName: "Mefenamic Acid",
    category: "Analgesic",
    strength: "250mg",
    company: "Pfizer",
    expiry: "2027-12-31",
    purchasePrice: 130,
    salePrice: 165,
    quantity: 72,
  },
  {
    brandName: "Disprin",
    genericName: "Aspirin",
    category: "Analgesic",
    strength: "300mg",
    company: "Reckitt",
    expiry: "2028-09-30",
    purchasePrice: 45,
    salePrice: 65,
    quantity: 180,
  },
  {
    brandName: "Tramal",
    genericName: "Tramadol",
    category: "Analgesic",
    strength: "50mg",
    company: "Grunenthal",
    expiry: "2027-11-30",
    purchasePrice: 210,
    salePrice: 270,
    quantity: 55,
  },
  {
    brandName: "Arcoxia",
    genericName: "Etoricoxib",
    category: "Anti-inflammatory",
    strength: "90mg",
    company: "MSD",
    expiry: "2028-01-31",
    purchasePrice: 380,
    salePrice: 460,
    quantity: 8,
  },
  {
    brandName: "Celebrex",
    genericName: "Celecoxib",
    category: "Anti-inflammatory",
    strength: "200mg",
    company: "Pfizer",
    expiry: "2028-02-29",
    purchasePrice: 420,
    salePrice: 510,
    quantity: 36,
  },
  {
    brandName: "Voltaren",
    genericName: "Diclofenac Sodium",
    category: "Anti-inflammatory",
    strength: "50mg",
    company: "GSK",
    expiry: "2026-11-20",
    purchasePrice: 110,
    salePrice: 140,
    quantity: 88,
  },
  {
    brandName: "Augmentin",
    genericName: "Amoxicillin + Clavulanic Acid",
    category: "Antibiotic",
    strength: "625mg",
    company: "GSK",
    expiry: "2027-09-30",
    purchasePrice: 320,
    salePrice: 395,
    quantity: 60,
  },
  {
    brandName: "Amoxil",
    genericName: "Amoxicillin",
    category: "Antibiotic",
    strength: "500mg",
    company: "GSK",
    expiry: "2028-04-30",
    purchasePrice: 140,
    salePrice: 175,
    quantity: 110,
  },
  {
    brandName: "Zithromax",
    genericName: "Azithromycin",
    category: "Antibiotic",
    strength: "500mg",
    company: "Pfizer",
    expiry: "2027-08-31",
    purchasePrice: 480,
    salePrice: 580,
    quantity: 28,
  },
  {
    brandName: "Ciproxin",
    genericName: "Ciprofloxacin",
    category: "Antibiotic",
    strength: "500mg",
    company: "Bayer",
    expiry: "2028-05-31",
    purchasePrice: 260,
    salePrice: 330,
    quantity: 64,
  },
  {
    brandName: "Flagyl",
    genericName: "Metronidazole",
    category: "Antibiotic",
    strength: "400mg",
    company: "Sanofi",
    expiry: "2028-07-31",
    purchasePrice: 90,
    salePrice: 120,
    quantity: 130,
  },
  {
    brandName: "Keflex",
    genericName: "Cephalexin",
    category: "Antibiotic",
    strength: "500mg",
    company: "Eli Lilly",
    expiry: "2027-07-31",
    purchasePrice: 220,
    salePrice: 275,
    quantity: 48,
  },
  {
    brandName: "Vibramycin",
    genericName: "Doxycycline",
    category: "Antibiotic",
    strength: "100mg",
    company: "Pfizer",
    expiry: "2028-08-31",
    purchasePrice: 150,
    salePrice: 190,
    quantity: 70,
  },
  {
    brandName: "Klaricid",
    genericName: "Clarithromycin",
    category: "Antibiotic",
    strength: "500mg",
    company: "Abbott",
    expiry: "2027-06-30",
    purchasePrice: 340,
    salePrice: 420,
    quantity: 42,
  },
  {
    brandName: "Zyrtec",
    genericName: "Cetirizine",
    category: "Antiallergic",
    strength: "10mg",
    company: "UCB",
    expiry: "2028-10-31",
    purchasePrice: 95,
    salePrice: 125,
    quantity: 120,
  },
  {
    brandName: "Claritin",
    genericName: "Loratadine",
    category: "Antiallergic",
    strength: "10mg",
    company: "Bayer",
    expiry: "2028-11-30",
    purchasePrice: 100,
    salePrice: 130,
    quantity: 100,
  },
  {
    brandName: "Allegra",
    genericName: "Fexofenadine",
    category: "Antiallergic",
    strength: "120mg",
    company: "Sanofi",
    expiry: "2028-12-31",
    purchasePrice: 160,
    salePrice: 200,
    quantity: 66,
  },
  {
    brandName: "Xyzal",
    genericName: "Levocetirizine",
    category: "Antiallergic",
    strength: "5mg",
    company: "UCB",
    expiry: "2027-12-31",
    purchasePrice: 115,
    salePrice: 145,
    quantity: 80,
  },
  {
    brandName: "Nexium",
    genericName: "Esomeprazole",
    category: "Antacid",
    strength: "40mg",
    company: "AstraZeneca",
    expiry: "2027-05-31",
    purchasePrice: 290,
    salePrice: 360,
    quantity: 58,
  },
  {
    brandName: "Losec",
    genericName: "Omeprazole",
    category: "Antacid",
    strength: "20mg",
    company: "AstraZeneca",
    expiry: "2028-01-31",
    purchasePrice: 180,
    salePrice: 230,
    quantity: 74,
  },
  {
    brandName: "Pepcid",
    genericName: "Famotidine",
    category: "Antacid",
    strength: "20mg",
    company: "Merck",
    expiry: "2028-02-29",
    purchasePrice: 120,
    salePrice: 155,
    quantity: 90,
  },
  {
    brandName: "Gaviscon",
    genericName: "Sodium Alginate + Sodium Bicarbonate",
    category: "Antacid",
    strength: "500mg",
    company: "Reckitt",
    expiry: "2027-11-30",
    purchasePrice: 150,
    salePrice: 190,
    quantity: 84,
  },
  {
    brandName: "Motilium",
    genericName: "Domperidone",
    category: "Gastrointestinal",
    strength: "10mg",
    company: "Janssen",
    expiry: "2028-03-31",
    purchasePrice: 105,
    salePrice: 135,
    quantity: 68,
  },
  {
    brandName: "Buscopan",
    genericName: "Hyoscine Butylbromide",
    category: "Gastrointestinal",
    strength: "10mg",
    company: "Boehringer Ingelheim",
    expiry: "2028-04-30",
    purchasePrice: 125,
    salePrice: 160,
    quantity: 76,
  },
  {
    brandName: "Imodium",
    genericName: "Loperamide",
    category: "Gastrointestinal",
    strength: "2mg",
    company: "Johnson & Johnson",
    expiry: "2026-11-28",
    purchasePrice: 80,
    salePrice: 105,
    quantity: 95,
  },
  {
    brandName: "Colofac",
    genericName: "Mebeverine Hydrochloride",
    category: "Gastrointestinal",
    strength: "135mg",
    company: "Abbott",
    expiry: "2028-05-31",
    purchasePrice: 170,
    salePrice: 215,
    quantity: 52,
  },
  {
    brandName: "Glucophage",
    genericName: "Metformin",
    category: "Antidiabetic",
    strength: "500mg",
    company: "Merck",
    expiry: "2028-06-30",
    purchasePrice: 95,
    salePrice: 125,
    quantity: 150,
  },
  {
    brandName: "Diamicron",
    genericName: "Gliclazide",
    category: "Antidiabetic",
    strength: "80mg",
    company: "Servier",
    expiry: "2027-09-30",
    purchasePrice: 135,
    salePrice: 170,
    quantity: 90,
  },
  {
    brandName: "Amaryl",
    genericName: "Glimepiride",
    category: "Antidiabetic",
    strength: "2mg",
    company: "Sanofi",
    expiry: "2028-07-31",
    purchasePrice: 145,
    salePrice: 185,
    quantity: 72,
  },
  {
    brandName: "Januvia",
    genericName: "Sitagliptin",
    category: "Antidiabetic",
    strength: "100mg",
    company: "MSD",
    expiry: "2027-08-31",
    purchasePrice: 520,
    salePrice: 625,
    quantity: 6,
  },
  {
    brandName: "Actos",
    genericName: "Pioglitazone",
    category: "Antidiabetic",
    strength: "30mg",
    company: "Takeda",
    expiry: "2028-08-31",
    purchasePrice: 280,
    salePrice: 350,
    quantity: 44,
  },
  {
    brandName: "Norvasc",
    genericName: "Amlodipine",
    category: "Antihypertensive",
    strength: "5mg",
    company: "Pfizer",
    expiry: "2027-12-31",
    purchasePrice: 110,
    salePrice: 140,
    quantity: 100,
  },
  {
    brandName: "Cozaar",
    genericName: "Losartan",
    category: "Antihypertensive",
    strength: "50mg",
    company: "MSD",
    expiry: "2028-09-30",
    purchasePrice: 190,
    salePrice: 240,
    quantity: 70,
  },
  {
    brandName: "Zestril",
    genericName: "Lisinopril",
    category: "Antihypertensive",
    strength: "10mg",
    company: "AstraZeneca",
    expiry: "2028-10-31",
    purchasePrice: 120,
    salePrice: 155,
    quantity: 82,
  },
  {
    brandName: "Concor",
    genericName: "Bisoprolol",
    category: "Cardiovascular",
    strength: "5mg",
    company: "Merck",
    expiry: "2026-12-01",
    purchasePrice: 130,
    salePrice: 165,
    quantity: 88,
  },
  {
    brandName: "Tenormin",
    genericName: "Atenolol",
    category: "Cardiovascular",
    strength: "50mg",
    company: "AstraZeneca",
    expiry: "2028-11-30",
    purchasePrice: 85,
    salePrice: 110,
    quantity: 96,
  },
  {
    brandName: "Aldactone",
    genericName: "Spironolactone",
    category: "Cardiovascular",
    strength: "25mg",
    company: "Pfizer",
    expiry: "2028-12-31",
    purchasePrice: 105,
    salePrice: 135,
    quantity: 64,
  },
  {
    brandName: "Lipitor",
    genericName: "Atorvastatin",
    category: "Cardiovascular",
    strength: "20mg",
    company: "Pfizer",
    expiry: "2027-06-30",
    purchasePrice: 230,
    salePrice: 290,
    quantity: 54,
  },
  {
    brandName: "Crestor",
    genericName: "Rosuvastatin",
    category: "Cardiovascular",
    strength: "10mg",
    company: "AstraZeneca",
    expiry: "2028-01-31",
    purchasePrice: 280,
    salePrice: 350,
    quantity: 9,
  },
  {
    brandName: "Redoxon",
    genericName: "Ascorbic Acid",
    category: "Vitamins and Supplements",
    strength: "500mg",
    company: "Bayer",
    expiry: "2028-02-29",
    purchasePrice: 90,
    salePrice: 120,
    quantity: 110,
  },
  {
    brandName: "Caltrate",
    genericName: "Calcium Carbonate + Vitamin D3",
    category: "Vitamins and Supplements",
    strength: "600mg",
    company: "Pfizer",
    expiry: "2027-07-31",
    purchasePrice: 260,
    salePrice: 320,
    quantity: 60,
  },
  {
    brandName: "Neurobion",
    genericName: "Vitamin B Complex",
    category: "Vitamins and Supplements",
    strength: "100mg",
    company: "Merck",
    expiry: "2028-03-31",
    purchasePrice: 160,
    salePrice: 205,
    quantity: 75,
  },
  {
    brandName: "Sangobion",
    genericName: "Ferrous Gluconate",
    category: "Vitamins and Supplements",
    strength: "30mg",
    company: "Merck",
    expiry: "2027-10-31",
    purchasePrice: 180,
    salePrice: 225,
    quantity: 66,
  },
  {
    brandName: "Folvite",
    genericName: "Folic Acid",
    category: "Vitamins and Supplements",
    strength: "5mg",
    company: "Pfizer",
    expiry: "2028-04-30",
    purchasePrice: 55,
    salePrice: 75,
    quantity: 130,
  },
  {
    brandName: "Singulair",
    genericName: "Montelukast",
    category: "Respiratory",
    strength: "10mg",
    company: "MSD",
    expiry: "2027-09-30",
    purchasePrice: 310,
    salePrice: 385,
    quantity: 50,
  },
  {
    brandName: "Ventolin",
    genericName: "Salbutamol",
    category: "Respiratory",
    strength: "2mg",
    company: "GSK",
    expiry: "2028-05-31",
    purchasePrice: 70,
    salePrice: 95,
    quantity: 85,
  },
  {
    brandName: "Theo-Dur",
    genericName: "Theophylline",
    category: "Respiratory",
    strength: "200mg",
    company: "Pfizer",
    expiry: "2027-08-31",
    purchasePrice: 140,
    salePrice: 180,
    quantity: 58,
  },
  {
    brandName: "Thyrox",
    genericName: "Levothyroxine",
    category: "Hormone",
    strength: "50mcg",
    company: "GSK",
    expiry: "2028-06-30",
    purchasePrice: 100,
    salePrice: 130,
    quantity: 80,
  },
].map((row, index) => ({
  ...row,
  demoKey: `DEMO-TAB-${String(index + 1).padStart(3, "0")}`,
  barcode: `DEMO-TAB-${String(index + 1).padStart(4, "0")}`,
  batch: `DEMO-TAB-B${String(index + 1).padStart(3, "0")}`,
}));

export const DEMO_TABLET_COUNT = DEMO_TABLET_ROWS.length;

export function buildDemoTabletRecords({ supplier, createdBy = "", timestamp } = {}) {
  const now = timestamp || new Date().toISOString();

  return DEMO_TABLET_ROWS.map((row, index) => {
    const name = `${row.brandName} ${row.strength}`.trim();

    return {
      id: `demo-tablet-${String(index + 1).padStart(3, "0")}`,
      demoKey: row.demoKey,
      demoSet: DEMO_TABLET_SET_ID,
      isDemo: true,
      dataSource: DEMO_TABLET_SOURCE,
      name,
      brandName: row.brandName,
      genericName: row.genericName,
      category: row.category,
      dosageForm: "Tablet",
      strength: row.strength,
      company: row.company,
      supplierId: supplier?.id || "",
      supplierName: supplier?.name || "",
      barcode: row.barcode,
      batch: row.batch,
      expiry: row.expiry,
      purchasePrice: row.purchasePrice,
      salePrice: row.salePrice,
      quantity: row.quantity,
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy,
    };
  });
}

export function summarizeDemoTablets(records) {
  const categories = new Set(records.map((record) => record.category));
  const expiries = records.map((record) => record.expiry).filter(Boolean).sort();

  return {
    count: records.length,
    categories: categories.size,
    units: records.reduce((total, record) => total + Number(record.quantity || 0), 0),
    costValue: records.reduce(
      (total, record) =>
        total + Number(record.purchasePrice || 0) * Number(record.quantity || 0),
      0
    ),
    retailValue: records.reduce(
      (total, record) => total + Number(record.salePrice || 0) * Number(record.quantity || 0),
      0
    ),
    margin: records.reduce(
      (total, record) =>
        total +
        (Number(record.salePrice || 0) - Number(record.purchasePrice || 0)) *
          Number(record.quantity || 0),
      0
    ),
    earliestExpiry: expiries[0] || "",
    latestExpiry: expiries[expiries.length - 1] || "",
  };
}

function isValidDateKey(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00`).getTime())
  );
}

function numberIsPositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function quantityIsValid(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0;
}

export function validateDemoTabletRecords({
  records,
  existingMedicines = [],
  supplier,
  today = todayISO(),
}) {
  const globalErrors = [];
  const rows = [];
  const seenKeys = new Set();
  const seenBarcodes = new Set();
  const seenNameBatches = new Set();
  const existingIds = new Set(existingMedicines.map((medicine) => medicine.id));
  const existingDemoKeys = new Set(
    existingMedicines.map((medicine) => medicine.demoKey).filter(Boolean)
  );
  const existingNameBatches = new Set(
    existingMedicines.map(
      (medicine) => `${normalizeKey(medicine.name)}|${normalizeKey(medicine.batch)}`
    )
  );
  const existingBarcodes = new Set(
    existingMedicines
      .map((medicine) => normalizeKey(medicine.barcode))
      .filter(Boolean)
  );

  if (!supplier?.id || !supplier?.name) {
    globalErrors.push(
      "Select an existing supplier before importing. Demo records must link to a supplier in your directory."
    );
  }

  if (records.length !== DEMO_TABLET_COUNT || records.length !== 50) {
    globalErrors.push(
      `The demo set must contain exactly 50 records. This set contains ${records.length}.`
    );
  }

  records.forEach((record, index) => {
    const label = `#${index + 1} ${record.name || "Untitled tablet"}`;
    const rowErrors = [];
    const demoKey = normalizeKey(record.demoKey);
    const barcode = normalizeKey(record.barcode);
    const nameBatch = `${normalizeKey(record.name)}|${normalizeKey(record.batch)}`;
    const alreadyImported =
      existingDemoKeys.has(record.demoKey) || existingIds.has(record.id);

    if (!record.name) rowErrors.push(`${label}: medicine name is required.`);
    if (!record.genericName) rowErrors.push(`${label}: generic name is required.`);
    if (!record.category) rowErrors.push(`${label}: category is required.`);
    if (record.dosageForm !== "Tablet") rowErrors.push(`${label}: dosage form must be Tablet.`);
    if (!record.strength) rowErrors.push(`${label}: strength is required.`);
    if (!record.company) rowErrors.push(`${label}: company / manufacturer is required.`);
    if (!record.batch) rowErrors.push(`${label}: batch number is required.`);
    if (!isValidDateKey(record.expiry)) {
      rowErrors.push(`${label}: expiry must be a valid date.`);
    } else if (record.expiry < today) {
      rowErrors.push(`${label}: expiry ${record.expiry} is not in the future.`);
    }
    if (!numberIsPositive(record.purchasePrice)) {
      rowErrors.push(`${label}: purchase price must be greater than zero.`);
    }
    if (!numberIsPositive(record.salePrice)) {
      rowErrors.push(`${label}: sale price must be greater than zero.`);
    }
    if (
      numberIsPositive(record.purchasePrice) &&
      numberIsPositive(record.salePrice) &&
      Number(record.salePrice) <= Number(record.purchasePrice)
    ) {
      rowErrors.push(`${label}: sale price must be higher than purchase price.`);
    }
    if (!quantityIsValid(record.quantity)) {
      rowErrors.push(`${label}: quantity must be a whole number greater than zero.`);
    }
    if (!/^DEMO-TAB-\d{4}$/.test(String(record.barcode || ""))) {
      rowErrors.push(`${label}: barcode must use the fictional DEMO-TAB-0001 format.`);
    }

    if (seenKeys.has(demoKey)) rowErrors.push(`${label}: duplicate demo key.`);
    if (seenBarcodes.has(barcode)) rowErrors.push(`${label}: duplicate demo barcode.`);
    if (seenNameBatches.has(nameBatch)) {
      rowErrors.push(`${label}: duplicate medicine name and batch.`);
    }

    if (!alreadyImported) {
      if (existingNameBatches.has(nameBatch)) {
        rowErrors.push(
          `${label}: another medicine already uses this name and batch. Import blocked.`
        );
      }
      if (barcode && existingBarcodes.has(barcode)) {
        rowErrors.push(`${label}: another medicine already uses this barcode. Import blocked.`);
      }
    }

    seenKeys.add(demoKey);
    seenBarcodes.add(barcode);
    seenNameBatches.add(nameBatch);

    rows.push({
      record,
      errors: rowErrors,
      status: alreadyImported ? "already" : rowErrors.length ? "conflict" : "new",
    });
  });

  const conflicts = rows.filter((row) => row.status === "conflict");
  const alreadyImported = rows.filter((row) => row.status === "already");
  const newRecords = rows.filter((row) => row.status === "new").map((row) => row.record);
  const rowErrors = rows.flatMap((row) => row.errors);
  const errors = [...globalErrors, ...rowErrors];

  return {
    errors,
    globalErrors,
    rows,
    conflicts,
    alreadyImported,
    newRecords,
    valid: errors.length === 0 && conflicts.length === 0,
    summary: summarizeDemoTablets(records),
  };
}
