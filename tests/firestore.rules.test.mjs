/*
 * Firestore security-rule tests for the device enrollment model.
 *
 * Run with:
 *   npx firebase emulators:exec --only firestore --project demo-pharmacysoft
 *     "node tests/firestore.rules.test.mjs"
 */
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const ADMIN_UID = "admin-uid";
const STAFF_UID = "staff-uid";
const DEVICE_A = "device-a-uid";
const DEVICE_B = "device-b-uid";
const OTHER_UID = "other-workspace-uid";
const WORKSPACE = "main";

const testEnv = await initializeTestEnvironment({
  projectId: "demo-pharmacysoft",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8080,
  },
});

function adminDb() {
  return testEnv.authenticatedContext(ADMIN_UID).firestore();
}

function staffDb() {
  return testEnv.authenticatedContext(STAFF_UID).firestore();
}

function deviceDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function anonymousDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function codeRef(db, code) {
  return doc(db, "pharmacies", WORKSPACE, "enrollmentCodes", code);
}

function memberRef(db, uid) {
  return doc(db, "pharmacies", WORKSPACE, "members", uid);
}

function enrollmentCodePayload(code, createdBy, overrides = {}) {
  return {
    code,
    pharmacyId: WORKSPACE,
    createdBy,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000)),
    usedBy: null,
    usedAt: null,
    ...overrides,
  };
}

function memberPayload(uid, code, overrides = {}) {
  return {
    uid,
    pharmacyId: WORKSPACE,
    active: true,
    role: "staff",
    enrollmentCode: code,
    enrolledAt: Timestamp.now(),
    ...overrides,
  };
}

async function seed() {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await setDoc(doc(db, "pharmacies", WORKSPACE), {
      name: "Pharmacy",
      workspaceId: WORKSPACE,
      active: true,
      createdAt: Timestamp.now(),
    });

    await setDoc(doc(db, "pharmacies", "other"), {
      name: "Other Pharmacy",
      workspaceId: "other",
      active: true,
      createdAt: Timestamp.now(),
    });

    await setDoc(memberRef(db, ADMIN_UID), {
      uid: ADMIN_UID,
      pharmacyId: WORKSPACE,
      active: true,
      role: "admin",
      enrolledAt: Timestamp.now(),
    });

    await setDoc(memberRef(db, STAFF_UID), {
      uid: STAFF_UID,
      pharmacyId: WORKSPACE,
      active: true,
      role: "staff",
      enrolledAt: Timestamp.now(),
    });

    await setDoc(doc(db, "pharmacies", "other", "members", OTHER_UID), {
      uid: OTHER_UID,
      pharmacyId: "other",
      active: true,
      role: "staff",
      enrolledAt: Timestamp.now(),
    });

    await setDoc(doc(db, "pharmacies", "other", "medicines", "existing"), {
      id: "existing",
      name: "Other pharmacy medicine",
      stock: 1,
    });

    await setDoc(doc(db, "pharmacies", WORKSPACE, "medicines", "existing"), {
      id: "existing",
      name: "Existing medicine",
      stock: 5,
    });
  });
}

const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error?.message || String(error) });
    console.log(`FAIL  ${name}`);
    console.log(`      ${error?.message || String(error)}`);
  }
}

await seed();

await check("Admin device can read the workspace document", async () => {
  await assertSucceeds(getDoc(doc(adminDb(), "pharmacies", WORKSPACE)));
});

await check("Admin device can read its own member document", async () => {
  await assertSucceeds(getDoc(memberRef(adminDb(), ADMIN_UID)));
});

await check("Unauthorized device can read its own (missing) member document", async () => {
  await assertSucceeds(getDoc(memberRef(deviceDb(DEVICE_A), DEVICE_A)));
});

await check("Unauthorized device cannot read the workspace document", async () => {
  await assertFails(getDoc(doc(deviceDb(DEVICE_A), "pharmacies", WORKSPACE)));
});

await check("Unauthorized device cannot read pharmacy medicines", async () => {
  await assertFails(
    getDoc(doc(deviceDb(DEVICE_A), "pharmacies", WORKSPACE, "medicines", "existing"))
  );
});

await check("Unauthenticated client cannot read pharmacy medicines", async () => {
  await assertFails(
    getDoc(doc(anonymousDb(), "pharmacies", WORKSPACE, "medicines", "existing"))
  );
});

await check("Admin device can create an enrollment code", async () => {
  const db = adminDb();
  const code = "ABCD-EFGH";

  await assertSucceeds(
    setDoc(codeRef(db, code), enrollmentCodePayload(code, ADMIN_UID))
  );
});

await check("Staff device cannot create an enrollment code", async () => {
  const db = staffDb();
  const code = "BCDE-FGHJ";

  await assertFails(
    setDoc(codeRef(db, code), enrollmentCodePayload(code, STAFF_UID))
  );
});

await check("Unauthorized device cannot create an enrollment code", async () => {
  const db = deviceDb(DEVICE_A);
  const code = "CDEF-GHJK";

  await assertFails(
    setDoc(codeRef(db, code), enrollmentCodePayload(code, DEVICE_A))
  );
});

await check("Admin device can list enrolled devices", async () => {
  await assertSucceeds(getDocs(collection(adminDb(), "pharmacies", WORKSPACE, "members")));
});

await check("Staff device cannot list enrolled devices", async () => {
  await assertFails(getDocs(collection(staffDb(), "pharmacies", WORKSPACE, "members")));
});

await check("Unauthorized device cannot list enrolled devices", async () => {
  await assertFails(
    getDocs(collection(deviceDb(DEVICE_A), "pharmacies", WORKSPACE, "members"))
  );
});

await check("Device A can claim a valid enrollment code", async () => {
  const db = deviceDb(DEVICE_A);

  await assertSucceeds(
    updateDoc(codeRef(db, "ABCD-EFGH"), { usedBy: DEVICE_A, usedAt: Timestamp.now() })
  );
});

await check("Device B cannot claim a code already claimed by Device A", async () => {
  const db = deviceDb(DEVICE_B);

  await assertFails(
    updateDoc(codeRef(db, "ABCD-EFGH"), { usedBy: DEVICE_B, usedAt: Timestamp.now() })
  );
});

await check("Device A can create its own staff member document", async () => {
  const db = deviceDb(DEVICE_A);

  await assertSucceeds(setDoc(memberRef(db, DEVICE_A), memberPayload(DEVICE_A, "ABCD-EFGH")));
});

await check("Enrolled Device A can read pharmacy data", async () => {
  await assertSucceeds(
    getDoc(doc(deviceDb(DEVICE_A), "pharmacies", WORKSPACE, "medicines", "existing"))
  );
});

await check("Enrolled Device A can write pharmacy data", async () => {
  await assertSucceeds(
    setDoc(doc(deviceDb(DEVICE_A), "pharmacies", WORKSPACE, "medicines", "new-item"), {
      id: "new-item",
      name: "New medicine",
      stock: 1,
    })
  );
});

await check("Enrolled staff cannot grant itself admin", async () => {
  const db = deviceDb(DEVICE_A);

  await assertFails(
    updateDoc(memberRef(db, DEVICE_A), { role: "admin", active: true })
  );
});

await check("Enrolled staff cannot resurrect a used code", async () => {
  const db = deviceDb(DEVICE_A);

  await assertFails(
    updateDoc(codeRef(db, "ABCD-EFGH"), { usedBy: null, usedAt: null })
  );
});

await check("Device B cannot enroll with a code used by Device A", async () => {
  const db = deviceDb(DEVICE_B);

  await assertFails(setDoc(memberRef(db, DEVICE_B), memberPayload(DEVICE_B, "ABCD-EFGH")));
});

await check("Device cannot enroll without a code", async () => {
  const db = deviceDb(DEVICE_B);

  await assertFails(setDoc(memberRef(db, DEVICE_B), memberPayload(DEVICE_B, "")));
});

await check("Device cannot enroll with a nonexistent code", async () => {
  const db = deviceDb(DEVICE_B);

  await assertFails(setDoc(memberRef(db, DEVICE_B), memberPayload(DEVICE_B, "ZZZZ-ZZZZ")));
});

await check("Device cannot self-enroll as admin", async () => {
  const db = deviceDb(DEVICE_B);

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      codeRef(context.firestore(), "WXYZ-2345"),
      enrollmentCodePayload("WXYZ-2345", ADMIN_UID, { usedBy: DEVICE_B })
    );
  });

  await assertFails(
    setDoc(memberRef(db, DEVICE_B), memberPayload(DEVICE_B, "WXYZ-2345", { role: "admin" }))
  );
});

await check("Expired enrollment code cannot be claimed", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      codeRef(context.firestore(), "EXPD-1234"),
      enrollmentCodePayload("EXPD-1234", ADMIN_UID, {
        expiresAt: Timestamp.fromDate(new Date(Date.now() - 60 * 1000)),
      })
    );
  });

  await assertFails(
    updateDoc(codeRef(deviceDb(DEVICE_B), "EXPD-1234"), {
      usedBy: DEVICE_B,
      usedAt: Timestamp.now(),
    })
  );
});

await check("Expired enrollment code cannot create a member document", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      codeRef(context.firestore(), "EXPD-5678"),
      enrollmentCodePayload("EXPD-5678", ADMIN_UID, {
        usedBy: DEVICE_B,
        expiresAt: Timestamp.fromDate(new Date(Date.now() - 60 * 1000)),
      })
    );
  });

  await assertFails(
    setDoc(memberRef(deviceDb(DEVICE_B), DEVICE_B), memberPayload(DEVICE_B, "EXPD-5678"))
  );
});

await check("Member of this workspace cannot read another workspace", async () => {
  await assertFails(
    getDoc(doc(staffDb(), "pharmacies", "other", "medicines", "existing"))
  );
});

await check("Member of another workspace cannot read this workspace", async () => {
  await assertFails(
    getDoc(doc(deviceDb(OTHER_UID), "pharmacies", WORKSPACE, "medicines", "existing"))
  );
});

await check("Invoice keys are write-once", async () => {
  const db = deviceDb(DEVICE_A);
  const reference = doc(db, "pharmacies", WORKSPACE, "invoiceKeys", "inv-1001");

  await assertSucceeds(
    setDoc(reference, {
      recordId: "sale-1",
      table: "sales",
      invoiceNumber: "INV-1001",
    })
  );

  await assertFails(updateDoc(reference, { recordId: "sale-2" }));
});

await check("Disabling a member blocks further data access", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(memberRef(context.firestore(), DEVICE_A), { active: false });
  });

  await assertFails(
    getDoc(doc(deviceDb(DEVICE_A), "pharmacies", WORKSPACE, "medicines", "existing"))
  );
});

const failed = results.filter((entry) => !entry.passed);

console.log("");
console.log(`${results.length - failed.length}/${results.length} checks passed`);

await testEnv.cleanup();

if (failed.length > 0) {
  process.exitCode = 1;
}
