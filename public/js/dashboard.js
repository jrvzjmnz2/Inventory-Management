// ---------- Auth guard ----------
const employeeId = sessionStorage.getItem('employeeId');
const employeeName = sessionStorage.getItem('employeeName');

if (!employeeId) {
  window.location.href = 'index.html';
}

document.getElementById('welcomeText').textContent = `${employeeName} (${employeeId})`;

document.getElementById('logoutBtn').addEventListener('click', () => {
  sessionStorage.removeItem('employeeId');
  sessionStorage.removeItem('employeeName');
  window.location.href = 'index.html';
});

// ---------- Small helpers ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setMessage(el, text, type) {
  el.textContent = text || '';
  el.classList.remove('error', 'success');
  if (type) el.classList.add(type);
}

// ---------- Tab switching ----------
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');

    if (btn.dataset.tab === 'inventory') {
      loadInventory();
    }
  });
});

// =======================================================
// BORROW TAB
// =======================================================
let borrowCart = []; // { equipmentId, item, comment }
const MISC_ITEMS = ['Masking Tape', 'Duct Tape', 'Zip Tie', 'Stickers', 'Printer Cable', 'HDMI Cable', 'DK-2205', 'Scissors'];

const borrowInput = document.getElementById('borrowInput');
const borrowAddBtn = document.getElementById('borrowAddBtn');
const borrowMessage = document.getElementById('borrowMessage');
const borrowCartBody = document.getElementById('borrowCartBody');
const borrowCompleteBtn = document.getElementById('borrowCompleteBtn');
const exportBtn = document.getElementById('exportBtn');
const borrowStatusMessage = document.getElementById('borrowStatusMessage');
const purposeSelect = document.getElementById('purposeSelect');
const eventInput = document.getElementById('eventInput');
const miscChecklist = document.getElementById('miscChecklist');

// Build the fixed checklist of miscellaneous items: a checkbox plus a
// +/- quantity stepper per row. The checked rows *are* the miscellaneous
// cart - there's no separate "add to cart" step.
miscChecklist.innerHTML = MISC_ITEMS.map(
  (item, idx) => `
    <div class="misc-row disabled" data-item="${escapeHtml(item)}">
      <label class="misc-checkbox-label">
        <input type="checkbox" class="misc-check" data-idx="${idx}">
        <span>${escapeHtml(item)}</span>
      </label>
      <div class="misc-stepper">
        <button type="button" class="stepper-btn misc-minus" data-idx="${idx}" disabled>−</button>
        <span class="stepper-value" id="miscQty-${idx}">1</span>
        <button type="button" class="stepper-btn misc-plus" data-idx="${idx}" disabled>+</button>
      </div>
    </div>`
).join('');

miscChecklist.querySelectorAll('.misc-check').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    const idx = checkbox.dataset.idx;
    const row = checkbox.closest('.misc-row');
    const minusBtn = row.querySelector('.misc-minus');
    const plusBtn = row.querySelector('.misc-plus');
    minusBtn.disabled = !checkbox.checked;
    plusBtn.disabled = !checkbox.checked;
    row.classList.toggle('disabled', !checkbox.checked);
    if (!checkbox.checked) {
      document.getElementById(`miscQty-${idx}`).textContent = '1';
    }
  });
});

miscChecklist.querySelectorAll('.misc-minus').forEach((btn) => {
  btn.addEventListener('click', () => {
    const qtyEl = document.getElementById(`miscQty-${btn.dataset.idx}`);
    const current = parseInt(qtyEl.textContent, 10);
    if (current > 1) qtyEl.textContent = String(current - 1);
  });
});

miscChecklist.querySelectorAll('.misc-plus').forEach((btn) => {
  btn.addEventListener('click', () => {
    const qtyEl = document.getElementById(`miscQty-${btn.dataset.idx}`);
    const current = parseInt(qtyEl.textContent, 10);
    qtyEl.textContent = String(current + 1);
  });
});

function getCheckedMiscItems() {
  const result = [];
  miscChecklist.querySelectorAll('.misc-check').forEach((checkbox) => {
    if (checkbox.checked) {
      const idx = checkbox.dataset.idx;
      const amount = parseInt(document.getElementById(`miscQty-${idx}`).textContent, 10);
      result.push({ item: MISC_ITEMS[idx], amount });
    }
  });
  return result;
}

function resetMiscChecklist() {
  miscChecklist.querySelectorAll('.misc-check').forEach((checkbox) => {
    checkbox.checked = false;
    const idx = checkbox.dataset.idx;
    document.getElementById(`miscQty-${idx}`).textContent = '1';
    const row = checkbox.closest('.misc-row');
    row.classList.add('disabled');
    row.querySelector('.misc-minus').disabled = true;
    row.querySelector('.misc-plus').disabled = true;
  });
}

borrowInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleBorrowAdd();
  }
});
borrowAddBtn.addEventListener('click', handleBorrowAdd);

async function handleBorrowAdd() {
  const id = borrowInput.value.trim();
  setMessage(borrowMessage, '', null);

  if (!id) {
    setMessage(borrowMessage, 'Enter an Equipment ID first.', 'error');
    return;
  }
  if (borrowCart.some((c) => c.equipmentId === id)) {
    setMessage(borrowMessage, `Equipment "${id}" is already in your cart.`, 'error');
    return;
  }

  try {
    const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok) {
      setMessage(borrowMessage, data.message || 'Equipment not found.', 'error');
      return;
    }

    if (data.status !== 'Available') {
      const borrower = data.employeeName
        ? `${data.employeeName} (${data.employeeId})`
        : data.employeeId || 'another employee';
      setMessage(
        borrowMessage,
        `"${data.item}" (${data.equipmentId}) is currently borrowed by ${borrower}. Please select another item.`,
        'error'
      );
      return;
    }

    borrowCart.push({ equipmentId: data.equipmentId, item: data.item, comment: data.comment });
    borrowInput.value = '';
    setMessage(borrowMessage, `Added "${data.item}" (${data.equipmentId}) to cart.`, 'success');
    renderBorrowCart();
  } catch (err) {
    setMessage(borrowMessage, 'Could not reach the server.', 'error');
  }
}

function renderBorrowCart() {
  if (borrowCart.length === 0) {
    borrowCartBody.innerHTML = '<tr class="empty-row"><td colspan="4">No equipment added yet.</td></tr>';
    return;
  }
  borrowCartBody.innerHTML = borrowCart
    .map(
      (c, idx) => `
      <tr>
        <td><span class="tag-chip">${escapeHtml(c.equipmentId)}</span></td>
        <td>${escapeHtml(c.item)}</td>
        <td>${escapeHtml(c.comment) || '-'}</td>
        <td><button class="remove-btn" data-idx="${idx}" type="button">Remove</button></td>
      </tr>`
    )
    .join('');

  borrowCartBody.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      borrowCart.splice(Number(btn.dataset.idx), 1);
      renderBorrowCart();
    });
  });
}

borrowCompleteBtn.addEventListener('click', async () => {
  setMessage(borrowStatusMessage, '', null);

  const miscItems = getCheckedMiscItems();

  if (borrowCart.length === 0 && miscItems.length === 0) {
    setMessage(borrowStatusMessage, 'Add at least one item before completing.', 'error');
    return;
  }

  const purpose = purposeSelect.value;
  if (borrowCart.length > 0 && !purpose) {
    setMessage(borrowStatusMessage, 'Select a Purpose before completing the borrow.', 'error');
    return;
  }

  const eventValue = eventInput.value.trim();
  if (borrowCart.length > 0 && !eventValue) {
    setMessage(borrowStatusMessage, 'Enter an Event before completing the borrow.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/borrow/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        purpose: purpose || null,
        event: eventValue || null,
        equipmentIds: borrowCart.map((c) => c.equipmentId),
        miscItems
      })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.conflicts) {
        const lines = data.conflicts.map((c) => {
          if (c.reason === 'unavailable') {
            return `${c.equipmentId} is now borrowed by ${c.borrowerId}.`;
          }
          return `${c.equipmentId} was not found.`;
        });
        setMessage(borrowStatusMessage, `${data.message} ${lines.join(' ')}`, 'error');
      } else {
        setMessage(borrowStatusMessage, data.message || 'Could not complete the borrow.', 'error');
      }
      return;
    }

    setMessage(borrowStatusMessage, 'Borrow completed. You can now export the Word document.', 'success');
    borrowCart = [];
    purposeSelect.value = '';
    eventInput.value = '';
    renderBorrowCart();
    resetMiscChecklist();
    exportBtn.disabled = false;
  } catch (err) {
    setMessage(borrowStatusMessage, 'Could not reach the server.', 'error');
  }
});

exportBtn.addEventListener('click', async () => {
  setMessage(borrowStatusMessage, 'Generating document…', null);
  try {
    const res = await fetch(`/api/export/${encodeURIComponent(employeeId)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(borrowStatusMessage, data.message || 'Could not generate the document.', 'error');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Borrow_Record_${employeeId}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    setMessage(borrowStatusMessage, 'Document downloaded.', 'success');
  } catch (err) {
    setMessage(borrowStatusMessage, 'Could not reach the server.', 'error');
  }
});

// =======================================================
// RETURN TAB
// =======================================================
let returnCart = []; // { equipmentId, item, borrowerId }

const returnInput = document.getElementById('returnInput');
const returnAddBtn = document.getElementById('returnAddBtn');
const returnMessage = document.getElementById('returnMessage');
const returnCartBody = document.getElementById('returnCartBody');
const returnCompleteBtn = document.getElementById('returnCompleteBtn');
const returnStatusMessage = document.getElementById('returnStatusMessage');

returnInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleReturnAdd();
  }
});
returnAddBtn.addEventListener('click', handleReturnAdd);

async function handleReturnAdd() {
  const id = returnInput.value.trim();
  setMessage(returnMessage, '', null);

  if (!id) {
    setMessage(returnMessage, 'Enter an Equipment ID first.', 'error');
    return;
  }
  if (returnCart.some((c) => c.equipmentId === id)) {
    setMessage(returnMessage, `Equipment "${id}" is already in your return cart.`, 'error');
    return;
  }

  try {
    const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok) {
      setMessage(returnMessage, data.message || 'Equipment not found.', 'error');
      return;
    }

    if (data.status !== 'Unavailable') {
      setMessage(returnMessage, `"${data.item}" (${data.equipmentId}) is not currently borrowed.`, 'error');
      return;
    }

    returnCart.push({
      equipmentId: data.equipmentId,
      item: data.item,
      borrowerId: data.employeeName ? `${data.employeeName} (${data.employeeId})` : data.employeeId
    });
    returnInput.value = '';
    setMessage(returnMessage, `Added "${data.item}" (${data.equipmentId}) to return cart.`, 'success');
    renderReturnCart();
  } catch (err) {
    setMessage(returnMessage, 'Could not reach the server.', 'error');
  }
}

function renderReturnCart() {
  if (returnCart.length === 0) {
    returnCartBody.innerHTML = '<tr class="empty-row"><td colspan="4">No equipment added yet.</td></tr>';
    return;
  }
  returnCartBody.innerHTML = returnCart
    .map(
      (c, idx) => `
      <tr>
        <td><span class="tag-chip">${escapeHtml(c.equipmentId)}</span></td>
        <td>${escapeHtml(c.item)}</td>
        <td>${escapeHtml(c.borrowerId)}</td>
        <td><button class="remove-btn" data-idx="${idx}" type="button">Remove</button></td>
      </tr>`
    )
    .join('');

  returnCartBody.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      returnCart.splice(Number(btn.dataset.idx), 1);
      renderReturnCart();
    });
  });
}

returnCompleteBtn.addEventListener('click', async () => {
  setMessage(returnStatusMessage, '', null);

  if (returnCart.length === 0) {
    setMessage(returnStatusMessage, 'Add at least one item before completing.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/return/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentIds: returnCart.map((c) => c.equipmentId) })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.invalid) {
        const lines = data.invalid.map((c) => `${c.equipmentId} (${c.reason.replace('_', ' ')})`);
        setMessage(returnStatusMessage, `${data.message} ${lines.join(', ')}`, 'error');
      } else {
        setMessage(returnStatusMessage, data.message || 'Could not complete the return.', 'error');
      }
      return;
    }

    setMessage(returnStatusMessage, 'Return completed successfully.', 'success');
    returnCart = [];
    renderReturnCart();
  } catch (err) {
    setMessage(returnStatusMessage, 'Could not reach the server.', 'error');
  }
});

// =======================================================
// VIEW INVENTORY TAB
// =======================================================
const inventoryBody = document.getElementById('inventoryBody');
const inventoryMessage = document.getElementById('inventoryMessage');
const inventoryFilterInputs = document.querySelectorAll('.col-filter');
document.getElementById('refreshInventoryBtn').addEventListener('click', loadInventory);

let inventoryItems = []; // full unfiltered dataset from the server
let inventoryFilters = {}; // { colKey: lowercased filter text (or exact status value) }

inventoryFilterInputs.forEach((el) => {
  const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
  el.addEventListener(eventName, () => {
    inventoryFilters[el.dataset.col] = el.value.trim().toLowerCase();
    applyInventoryFilters();
  });
});

document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  inventoryFilterInputs.forEach((el) => {
    el.value = '';
  });
  inventoryFilters = {};
  applyInventoryFilters();
});

function textMatches(value, filterValue) {
  if (!filterValue) return true;
  return String(value || '')
    .toLowerCase()
    .includes(filterValue);
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

async function loadInventory() {
  inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="9">Loading inventory…</td></tr>';
  setMessage(inventoryMessage, '', null);
  try {
    const res = await fetch('/api/equipment');
    const items = await res.json();

    if (!res.ok) {
      inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="9">Could not load inventory.</td></tr>';
      return;
    }

    inventoryItems = items;
    applyInventoryFilters();
  } catch (err) {
    inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="9">Could not reach the server.</td></tr>';
  }
}

// Filtering happens entirely client-side against the already-loaded dataset,
// so typing in a column filter is instant and doesn't hit the server.
function applyInventoryFilters() {
  const filtered = inventoryItems.filter((i) => {
    const borrowerText = i.employeeId ? `${i.employeeName || ''} ${i.employeeId}` : '';
    const lastBorrowedText = i.lastBorrowedBy ? `${i.lastBorrowedByName || ''} ${i.lastBorrowedBy}` : '';
    const lastBorrowedDateText = formatDateTime(i.lastBorrowedAt);

    return (
      textMatches(i.equipmentId, inventoryFilters.equipmentId) &&
      textMatches(i.item, inventoryFilters.item) &&
      (!inventoryFilters.status || i.status === inventoryFilters.status) &&
      textMatches(i.comment, inventoryFilters.comment) &&
      textMatches(i.additionalInfo, inventoryFilters.additionalInfo) &&
      textMatches(borrowerText, inventoryFilters.borrower) &&
      textMatches(i.event, inventoryFilters.event) &&
      textMatches(lastBorrowedText, inventoryFilters.lastBorrowedByName) &&
      textMatches(lastBorrowedDateText, inventoryFilters.lastBorrowedAt)
    );
  });

  renderInventoryRows(filtered);
}

// Note: Purpose is intentionally left off this table (still tracked in the
// database and included in the Word export) - hidden from the web UI only.
function renderInventoryRows(items) {
  if (inventoryItems.length === 0) {
    inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="9">No equipment in the database.</td></tr>';
    return;
  }
  if (items.length === 0) {
    inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="9">No equipment matches the current filters.</td></tr>';
    return;
  }

  inventoryBody.innerHTML = items
    .map((i) => {
      const pillClass = i.status === 'Available' ? 'status-available' : 'status-unavailable';
      const borrower = i.employeeId ? `${escapeHtml(i.employeeName)} (${escapeHtml(i.employeeId)})` : '-';
      const lastBorrower = i.lastBorrowedBy
        ? `${escapeHtml(i.lastBorrowedByName)} (${escapeHtml(i.lastBorrowedBy)})`
        : '-';
      return `
      <tr>
        <td><span class="tag-chip">${escapeHtml(i.equipmentId)}</span></td>
        <td>${escapeHtml(i.item)}</td>
        <td><span class="status-pill ${pillClass}">${escapeHtml(i.status)}</span></td>
        <td>
          <input
            type="text"
            class="comment-input"
            data-equipment-id="${escapeHtml(i.equipmentId)}"
            data-field="comment"
            data-endpoint="comment"
            value="${escapeHtml(i.comment)}"
            placeholder="Add a comment…"
          >
        </td>
        <td>
          <input
            type="text"
            class="comment-input"
            data-equipment-id="${escapeHtml(i.equipmentId)}"
            data-field="additionalInfo"
            data-endpoint="additional-info"
            value="${escapeHtml(i.additionalInfo)}"
            placeholder="Add additional information…"
          >
        </td>
        <td>${borrower}</td>
        <td>${escapeHtml(i.event) || '-'}</td>
        <td>${lastBorrower}</td>
        <td>${formatDateTime(i.lastBorrowedAt)}</td>
      </tr>`;
    })
    .join('');

  inventoryBody.querySelectorAll('.comment-input').forEach((input) => {
    input.dataset.original = input.value;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('blur', () => saveEditableField(input));
  });
}

function flashCommentInput(input, success) {
  input.classList.remove('comment-saved', 'comment-error');
  void input.offsetWidth; // restart CSS transition if it's already mid-flash
  input.classList.add(success ? 'comment-saved' : 'comment-error');
  setTimeout(() => input.classList.remove('comment-saved', 'comment-error'), 1200);
}

// Shared handler for both the Comment and Additional Information columns -
// which field and API endpoint to use come from the input's data attributes.
async function saveEditableField(input) {
  const newValue = input.value.trim();
  if (newValue === input.dataset.original) return; // unchanged, nothing to save

  const equipmentId = input.dataset.equipmentId;
  const field = input.dataset.field;
  const endpoint = input.dataset.endpoint;
  input.disabled = true;
  setMessage(inventoryMessage, '', null);

  try {
    const res = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: newValue })
    });
    const data = await res.json();

    if (!res.ok) {
      input.value = input.dataset.original;
      flashCommentInput(input, false);
      setMessage(inventoryMessage, data.message || `Could not save changes for ${equipmentId}.`, 'error');
    } else {
      input.dataset.original = data[field];
      input.value = data[field];
      flashCommentInput(input, true);
      const match = inventoryItems.find((it) => it.equipmentId === equipmentId);
      if (match) match[field] = data[field];
    }
  } catch (err) {
    input.value = input.dataset.original;
    flashCommentInput(input, false);
    setMessage(inventoryMessage, 'Could not reach the server.', 'error');
  } finally {
    input.disabled = false;
  }
}

// Load inventory once on first page load too, so switching tabs feels instant.
loadInventory();

// =======================================================
// BARCODE SCANNER (Borrow & Return)
// =======================================================
// Uses the html5-qrcode library (loaded via <script> in dashboard.html) to
// open the camera, draw a scanning-box outline over the video feed, and
// decode common barcode/QR formats. A successful scan fills whichever
// input triggered the scan (Borrow or Return) and runs that tab's normal
// add flow, so scanned equipment goes through the exact same
// availability check as a typed-in ID.
const scanBorrowBtn = document.getElementById('scanBorrowBtn');
const scanReturnBtn = document.getElementById('scanReturnBtn');
const scannerModal = document.getElementById('scannerModal');
const scannerCloseBtn = document.getElementById('scannerCloseBtn');
const scannerError = document.getElementById('scannerError');
let activeScanner = null;
let scanTarget = null; // { input, handler } - which tab requested the scan

scanBorrowBtn.addEventListener('click', () => startScanner(borrowInput, handleBorrowAdd));
scanReturnBtn.addEventListener('click', () => startScanner(returnInput, handleReturnAdd));
scannerCloseBtn.addEventListener('click', stopScanner);

async function startScanner(inputEl, addHandler) {
  scanTarget = { input: inputEl, handler: addHandler };
  scannerError.textContent = '';
  scannerModal.classList.remove('hidden');

  if (typeof Html5Qrcode === 'undefined') {
    scannerError.textContent = 'Barcode scanner failed to load. Check your connection and try again.';
    return;
  }

  activeScanner = new Html5Qrcode('scannerViewport');
  try {
    await activeScanner.start(
      // Prefer the back/rear camera when available, and ask for a higher
      // resolution feed - barcodes are small and low-res video makes them
      // much harder to decode, especially on laptop webcams.
      { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      { fps: 10, qrbox: { width: 260, height: 160 } }, // draws the scan-box outline
      onScanSuccess,
      () => {} // per-frame "nothing found yet" callback - ignore and keep scanning
    );
  } catch (err) {
    scannerError.textContent = 'Could not access the camera. Check permissions and try again.';
  }
}

async function onScanSuccess(decodedText) {
  const id = decodedText.trim();
  const target = scanTarget;
  await stopScanner();
  if (!target) return;
  target.input.value = id;
  target.handler();
}

async function stopScanner() {
  scannerModal.classList.add('hidden');
  if (activeScanner) {
    try {
      await activeScanner.stop();
      activeScanner.clear();
    } catch (err) {
      // Scanner may already be stopped/never fully started - safe to ignore.
    }
    activeScanner = null;
  }
}
