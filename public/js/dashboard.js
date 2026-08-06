// ---------- Auth guard ----------
const employeeId = sessionStorage.getItem('employeeId');
const employeeName = sessionStorage.getItem('employeeName');

if (!employeeId) {
  window.location.href = 'index.html';
}

document.getElementById('welcomeText').textContent = `${employeeName} (${employeeId})`;

// ---------- Admin mode ----------
// The "Admin" employeeId unlocks a few extra powers on this page: editing
// any inventory cell, borrowing/reserving on behalf of another employee,
// and importing equipment via CSV. It's just a regular registered account
// with this exact ID - no separate roles/permissions system.
const ADMIN_EMPLOYEE_ID = 'Admin';
const isAdmin = employeeId === ADMIN_EMPLOYEE_ID;
if (isAdmin) {
  document.getElementById('adminBadge').classList.remove('hidden');
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.remove('hidden'));
}

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

// The raw Equipment ID is only ever shown to the Admin account in the
// Borrow/Return/Reserve cart tables - everyone else works off Location/Item/
// barcode scans instead there. Used everywhere one of those cart rows used
// to lead with the ID, so the cell's hidden state always matches its
// table's own admin-only-hidden header (keeping column count and alignment
// intact either way).
function idCell(equipmentId) {
  return isAdmin ? `<td><span class="tag-chip">${escapeHtml(equipmentId)}</span></td>` : '<td class="hidden"></td>';
}

// My Items shows the raw Equipment ID to everyone, admin or not - unlike
// idCell() above.
function homeIdCell(equipmentId) {
  return `<td><span class="tag-chip">${escapeHtml(equipmentId)}</span></td>`;
}

// Same idea for the " (EQ001)" suffix that used to tag along on Borrow/
// Return/Reserve status messages - Admin still sees it, everyone else just
// gets the item name on its own.
function idSuffix(equipmentId) {
  return isAdmin ? ` (${equipmentId})` : '';
}

// For the conflict/invalid lists returned when completing a cart - Admin
// still gets "Item" (EQ001), everyone else just gets "Item" (looked up from
// the cart already sitting in memory, since the conflict response itself
// only carries the ID).
function conflictLabel(cart, equipmentId) {
  const found = cart.find((c) => c.equipmentId === equipmentId);
  const name = found ? `"${found.item}"` : 'That item';
  return isAdmin ? `${name} (${equipmentId})` : name;
}

// For messages built around an ID the user picked from the Borrow/Reserve
// suggestion dropdown (rather than one they typed or scanned themselves) -
// Admin still sees the raw ID, everyone else gets the item name looked up
// from the already-loaded inventory list.
function idLabel(equipmentId) {
  if (isAdmin) return equipmentId;
  const match = inventoryItems.find((it) => it.equipmentId === equipmentId);
  return match ? `"${match.item}"` : 'That item';
}

// Some existing inventory rows have their status stored in uppercase
// (AVAILABLE/UNAVAILABLE/RESERVED) from before this app's own borrow/
// return/reserve actions settled on proper case (Available/Unavailable/
// Reserved). This maps either casing (or anything else) to the canonical
// proper-case label, so color-coding and display are consistent no matter
// how a given row's status was originally written.
const CANONICAL_STATUSES = ['Available', 'Unavailable', 'Reserved'];
function normalizeStatusLabel(status) {
  const match = CANONICAL_STATUSES.find((s) => s.toUpperCase() === String(status || '').toUpperCase());
  return match || status || '';
}

// ---------- Shared confirmation modal ----------
// Used by the Complete button on every tab so nothing gets finalized
// without an explicit "yes". Returns a Promise<boolean> - true if the user
// confirmed, false if they cancelled.
const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const confirmOkBtn = document.getElementById('confirmOkBtn');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
let resolveConfirm = null;

function askConfirm(message) {
  confirmMessage.textContent = message;
  confirmModal.classList.remove('hidden');
  return new Promise((resolve) => {
    resolveConfirm = resolve;
  });
}

function settleConfirm(result) {
  confirmModal.classList.add('hidden');
  if (resolveConfirm) {
    resolveConfirm(result);
    resolveConfirm = null;
  }
}

confirmOkBtn.addEventListener('click', () => settleConfirm(true));
confirmCancelBtn.addEventListener('click', () => settleConfirm(false));

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
    if (btn.dataset.tab === 'home') {
      loadMyItems();
    }
  });
});

// =======================================================
// MY ITEMS (HOME) TAB
// =======================================================
// Shows only the logged-in employee's own equipment that's currently
// Reserved (held, on the shelf) or Unavailable (checked out) - anything
// fully Available isn't "theirs" to act on, so it's left off this view.
const homeBody = document.getElementById('homeBody');
const homeMessage = document.getElementById('homeMessage');
const homeViewIdInput = document.getElementById('homeViewIdInput');
const homeViewIdBtn = document.getElementById('homeViewIdBtn');
const homeViewingLabel = document.getElementById('homeViewingLabel');
document.getElementById('refreshHomeBtn').addEventListener('click', loadMyItems);

// Admin can look up any employee's ID here to see (and act on) their My
// Items list instead of just their own - everyone else always sees their own
// items, this whole ID field is admin-only (see .admin-only unhide above).
let homeViewingId = employeeId;

function setHomeViewingId(targetId) {
  homeViewingId = (isAdmin && targetId && targetId.trim()) || employeeId;
  if (isAdmin) {
    homeViewIdInput.value = homeViewingId === employeeId ? '' : homeViewingId;
    if (homeViewingId !== employeeId) {
      setMessage(homeViewingLabel, `Viewing items for "${homeViewingId}". Clear the field and press View to go back to your own.`, null);
    } else {
      setMessage(homeViewingLabel, '', null);
    }
  }
  loadMyItems();
}

if (isAdmin) {
  homeViewIdBtn.addEventListener('click', () => setHomeViewingId(homeViewIdInput.value));
  homeViewIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setHomeViewingId(homeViewIdInput.value);
    }
  });
}

async function loadMyItems() {
  homeBody.innerHTML = '<tr class="empty-row"><td colspan="5">Loading items…</td></tr>';
  setMessage(homeMessage, '', null);
  try {
    const res = await fetch('/api/equipment');
    const items = await res.json();
    if (!res.ok) {
      homeBody.innerHTML = '<tr class="empty-row"><td colspan="5">Could not load items.</td></tr>';
      return;
    }

    const mine = items.filter((i) => {
      if (i.employeeId !== homeViewingId) return false;
      const statusLabel = normalizeStatusLabel(i.status);
      return statusLabel === 'Reserved' || statusLabel === 'Unavailable';
    });

    // A pending reservation (future start time) doesn't touch employeeId/
    // status at all - the item stays Available to everyone else in the
    // meantime - so it has to be pulled in separately here rather than
    // showing up in the filter above. Shown as its own "Upcoming" row,
    // grouped by its own pending event name.
    const myPending = items
      .filter(
        (i) =>
          i.pendingReservation &&
          i.pendingReservation.employeeId === homeViewingId &&
          new Date(i.pendingReservation.end).getTime() > Date.now()
      )
      .map((i) => ({ ...i, isPending: true, event: i.pendingReservation.event }));

    renderMyItems([...myPending, ...mine]);
  } catch (err) {
    homeBody.innerHTML = '<tr class="empty-row"><td colspan="5">Could not reach the server.</td></tr>';
  }
}

// Groups by event name (case-sensitive on the literal value, blank/missing
// events collected under "No Event") and sorts the sections alphabetically,
// with "No Event" always last since it's not really a named event.
function groupItemsByEvent(items) {
  const groups = new Map();
  items.forEach((i) => {
    const key = i.event && i.event.trim() ? i.event.trim() : 'No Event';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === 'No Event') return b === 'No Event' ? 0 : 1;
    if (b === 'No Event') return -1;
    return a.localeCompare(b);
  });
}

const SCAN_ICON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3 7.17 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.17L15 3H9zm3 15a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>';

// Makes a text input only accept input from a physical barcode scanner, not
// manual keyboard typing. A physical scanner acts exactly like a keyboard
// (it sends real keydown events character-by-character) so there's no
// browser API that flags "this came from a scanner" - the only observable
// difference is speed: a scanner fires each character a few milliseconds
// apart, far faster than any human keystroke. This never writes typed
// characters into the field at all (every keydown is prevented) - it just
// buffers them internally and only calls onScan(...) once Enter arrives and
// every character up to that point arrived within the scanner-speed window.
// A slower gap anywhere in the sequence invalidates that whole attempt, so
// someone typing by hand never gets a value out of this field, and the
// field never visibly shows anything they typed.
function bindScanOnlyInput(inputEl, onScan) {
  const MAX_GAP_MS = 50; // physical scanners type each character only a few ms apart
  let buffer = '';
  let lastTime = null;
  let invalidated = false;

  inputEl.addEventListener('keydown', (e) => {
    // Let Tab (and browser/OS shortcuts using modifier keys) behave
    // normally - only ordinary character keys and Enter are captured here.
    if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();

    if (e.key === 'Enter') {
      const scanned = buffer;
      buffer = '';
      lastTime = null;
      const wasValid = !invalidated && scanned.length > 0;
      invalidated = false;
      if (wasValid) onScan(scanned);
      return;
    }

    if (e.key.length !== 1) return; // ignore Shift, Backspace, arrow keys, etc.

    const now = performance.now();
    if (lastTime !== null && now - lastTime > MAX_GAP_MS) {
      invalidated = true;
      buffer = '';
    }
    lastTime = now;
    if (!invalidated) buffer += e.key;
  });

  // Paste/drag-and-drop don't go through keydown at all, so they'd otherwise
  // be a way to slip text into this field without ever "typing" it.
  inputEl.addEventListener('paste', (e) => e.preventDefault());
  inputEl.addEventListener('drop', (e) => e.preventDefault());
}

// If someone else has put a future (pending) reservation on an item this
// employee currently has checked out, borrowing doesn't get blocked by that
// up front (see routes/borrow.js) - but if the borrower doesn't return it in
// time, that other person's reservation silently lapses and never activates
// (see autoExpireReservation in routes/equipment.js). Since there's no
// email/push layer in this app, the only way to "notify" the borrower is an
// on-screen warning here in My Items - shown once the pending reservation's
// start is within a day out, so there's still time to return it beforehand.
function pendingReturnWarning(i) {
  const pending = i.pendingReservation;
  if (!pending || pending.employeeId === i.employeeId) return null;
  if (new Date(pending.end).getTime() <= Date.now()) return null; // already lapsed
  const hoursUntilStart = (new Date(pending.start).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilStart > 24) return null;
  return pending;
}

function renderMyItemRow(i) {
  // A pending reservation hasn't started yet - the item is still fully
  // Available to everyone else in the meantime, so there's nothing to
  // borrow/return/end here, just the option to cancel it before it starts.
  if (i.isPending) {
    const pending = i.pendingReservation;
    return `
    <tr>
      ${homeIdCell(i.equipmentId)}
      <td>${escapeHtml(i.item)}</td>
      <td><span class="status-pill status-upcoming">Upcoming</span></td>
      <td>${formatDateTime(pending.start)} &rarr; ${formatDateTime(pending.end)}</td>
      <td class="action-row">
        <button class="remove-btn home-cancel-btn" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}" type="button">Cancel Reservation</button>
      </td>
    </tr>`;
  }

  const statusLabel = normalizeStatusLabel(i.status);
  const pillClass = statusLabel === 'Reserved' ? 'status-reserved' : 'status-unavailable';
  const reservationActive = Boolean(i.reservedUntil) && new Date(i.reservedUntil).getTime() > Date.now();
  const heldUntil = i.reservedUntil ? formatDateTime(i.reservedUntil) : '-';

  let actionsHtml = '';
  if (statusLabel === 'Reserved') {
    actionsHtml = `
      <button class="secondary-btn home-borrow-btn" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}" type="button">Borrow Now</button>
      <button class="remove-btn home-cancel-btn" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}" type="button">Cancel Reservation</button>`;
  } else if (statusLabel === 'Unavailable') {
    // Returning here is barcode-verified, same principle as the Return tab:
    // scan with the camera, or with a physical (keyboard-emulating) barcode
    // scanner - either way the scanned code must match this exact item
    // before it's actually returned. No one-click "just return it" button -
    // except for Admin looking at someone else's list, who won't have the
    // physical item on hand to scan in the first place, so a direct button
    // is offered there instead.
    const adminViewingOther = isAdmin && homeViewingId !== employeeId;
    actionsHtml = `
      ${
        adminViewingOther
          ? `<button class="secondary-btn home-admin-return-btn" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}" type="button">Return</button>`
          : ''
      }
      <div class="home-return-scan-group" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}">
        <input type="text" class="comment-input home-return-scan-input" placeholder="Scan barcode to return">
        <button class="scan-btn home-scan-camera-btn" type="button" aria-label="Scan with camera to return" title="Scan with camera to return">${SCAN_ICON_SVG}</button>
      </div>
      ${reservationActive ? `<button class="remove-btn home-end-btn" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}" type="button">End Reservation</button>` : ''}`;
  }

  const warning = statusLabel === 'Unavailable' ? pendingReturnWarning(i) : null;

  return `
  <tr>
    ${homeIdCell(i.equipmentId)}
    <td>${escapeHtml(i.item)}</td>
    <td><span class="status-pill ${pillClass}">${escapeHtml(statusLabel)}</span></td>
    <td>${heldUntil}</td>
    <td class="action-row">${actionsHtml}</td>
  </tr>${
    warning
      ? `<tr class="my-items-warning-row"><td colspan="5">Please return "${escapeHtml(i.item)}" by ${formatDateTime(warning.start)} - it's reserved${warning.event ? ` for "${escapeHtml(warning.event)}"` : ''} starting then.</td></tr>`
      : ''
  }`;
}

function renderMyItems(items) {
  if (items.length === 0) {
    const who = homeViewingId === employeeId ? 'You don\'t' : `"${escapeHtml(homeViewingId)}" doesn't`;
    homeBody.innerHTML = `<tr class="empty-row"><td colspan="5">${who} have any equipment reserved or checked out right now.</td></tr>`;
    return;
  }

  const groups = groupItemsByEvent(items);
  homeBody.innerHTML = groups
    .map(
      ([eventName, groupItems]) =>
        `<tr class="event-section-header">
          <td colspan="4">${escapeHtml(eventName)}</td>
          <td class="action-row">
            <button class="secondary-btn event-list-btn" data-event="${escapeHtml(eventName)}" type="button">Create Equipment List</button>
          </td>
        </tr>${groupItems.map(renderMyItemRow).join('')}`
    )
    .join('');

  homeBody.querySelectorAll('.event-list-btn').forEach((btn) => {
    btn.addEventListener('click', () => createEventEquipmentList(btn.dataset.event));
  });
  homeBody.querySelectorAll('.home-borrow-btn').forEach((btn) => {
    btn.addEventListener('click', () => homeBorrowNow(btn.dataset.equipmentId, btn.dataset.item));
  });
  homeBody.querySelectorAll('.home-end-btn').forEach((btn) => {
    btn.addEventListener('click', () => homeCancelReservation(btn.dataset.equipmentId, btn.dataset.item));
  });
  homeBody.querySelectorAll('.home-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => homeCancelReservation(btn.dataset.equipmentId, btn.dataset.item));
  });
  homeBody.querySelectorAll('.home-admin-return-btn').forEach((btn) => {
    btn.addEventListener('click', () => homeReturnDirect(btn.dataset.equipmentId, btn.dataset.item));
  });
  homeBody.querySelectorAll('.home-return-scan-group').forEach((group) => {
    const equipmentId = group.dataset.equipmentId;
    const itemLabel = group.dataset.item;
    const input = group.querySelector('.home-return-scan-input');
    const camBtn = group.querySelector('.home-scan-camera-btn');
    // This field only accepts a physical barcode scanner's input, never
    // manual keyboard typing - see bindScanOnlyInput below.
    bindScanOnlyInput(input, (scanned) => homeReturnByScan(equipmentId, scanned, input, itemLabel));
    // Camera path reuses the same scanner modal as every other tab - it sets
    // input.value directly (see onScanSuccess), bypassing the keydown-timing
    // check entirely, so it's unaffected by the restriction above.
    camBtn.addEventListener('click', () => startScanner(input, () => homeReturnByScan(equipmentId, input.value, input, itemLabel)));
  });
}

// Downloads a .docx equipment list for one event section - same document
// generation mechanism as the "Export to Word" button on the Borrow tab
// (GET a .docx, turn the response into a blob, trigger a download), just
// scoped to whichever event group the button was clicked under, and for
// whichever employee is currently being viewed (so Admin looking at
// someone else's My Items list downloads that employee's list, not their
// own).
async function createEventEquipmentList(eventName) {
  setMessage(homeMessage, 'Generating document…', null);
  try {
    const res = await fetch(
      `/api/export/event/${encodeURIComponent(homeViewingId)}?event=${encodeURIComponent(eventName)}`
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(homeMessage, data.message || 'Could not generate the document.', 'error');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Equipment_List_${homeViewingId}_${eventName}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    setMessage(homeMessage, 'Document downloaded.', 'success');
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

// One-click "Borrow Now" for an item already shown to be reserved by this
// employee - reuses the equipment's own existing purpose/event (set back
// when it was reserved) so it passes the same validation Borrow normally
// requires, without making the user re-fill a form for something they
// already specified.
async function homeBorrowNow(equipmentId, itemLabel) {
  setMessage(homeMessage, '', null);
  const label = isAdmin ? equipmentId : itemLabel || 'this item';
  const forWhom = homeViewingId === employeeId ? 'you' : `"${homeViewingId}"`;
  const confirmed = await askConfirm(`Borrow "${label}" now? It'll stay reserved for ${forWhom} until it's returned or the hold period ends.`);
  if (!confirmed) return;

  try {
    const lookup = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}`);
    const eq = await lookup.json();
    if (!lookup.ok) {
      setMessage(homeMessage, eq.message || 'Could not look up that item.', 'error');
      return;
    }

    const res = await fetch('/api/borrow/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: homeViewingId,
        purpose: eq.purpose,
        event: eq.event,
        equipmentIds: [equipmentId],
        miscItems: []
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not borrow that item.', 'error');
      return;
    }
    setMessage(homeMessage, `Borrowed "${label}".`, 'success');
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

// Returning from My Items is barcode-verified rather than one click: the
// scanned/typed code has to match this exact equipmentId before anything is
// sent to the server. That match is itself the confirmation, so unlike the
// other My Items actions this doesn't also pop the "are you sure" modal.
async function homeReturnByScan(equipmentId, scannedValue, inputEl, itemLabel) {
  const scanned = String(scannedValue || '').trim();
  if (!scanned) return;

  const label = isAdmin ? equipmentId : itemLabel || 'this item';
  if (scanned.toUpperCase() !== equipmentId.toUpperCase()) {
    setMessage(homeMessage, `Scanned code "${scanned}" doesn't match "${label}" - scan that item's own barcode.`, 'error');
    if (inputEl) inputEl.value = '';
    return;
  }

  setMessage(homeMessage, '', null);
  try {
    const res = await fetch('/api/return/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentIds: [equipmentId] })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not return that item.', 'error');
      if (inputEl) inputEl.value = '';
      return;
    }
    setMessage(homeMessage, `Returned "${label}".`, 'success');
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
    if (inputEl) inputEl.value = '';
  }
}

// Admin-only shortcut: when looking at someone else's My Items list, Admin
// won't have the physical item in hand to scan its barcode, so this returns
// it directly with a single button press instead - skipping the barcode
// match that everyone else (including Admin viewing their own list) still
// goes through.
async function homeReturnDirect(equipmentId, itemLabel) {
  setMessage(homeMessage, '', null);
  const label = isAdmin ? equipmentId : itemLabel || 'this item';
  const confirmed = await askConfirm(`Return "${label}" for "${homeViewingId}" without scanning its barcode?`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/return/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentIds: [equipmentId] })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not return that item.', 'error');
      return;
    }
    setMessage(homeMessage, `Returned "${label}".`, 'success');
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

async function homeCancelReservation(equipmentId, itemLabel) {
  setMessage(homeMessage, '', null);
  const label = isAdmin ? equipmentId : itemLabel || 'this item';
  const confirmed = await askConfirm(`Cancel/end the reservation on "${label}"?`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/reserve/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: homeViewingId, equipmentIds: [equipmentId] })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not cancel that reservation.', 'error');
      return;
    }
    setMessage(homeMessage, `Reservation on "${label}" cancelled.`, 'success');
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

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
const borrowOnBehalfInput = document.getElementById('borrowOnBehalfInput');

// Builds a fixed checklist of miscellaneous items inside `containerEl`: a
// checkbox plus a +/- quantity stepper per row. The checked rows *are* the
// miscellaneous cart - there's no separate "add to cart" step. Used for both
// the Borrow and Reserve tabs, each with their own container element and
// independent state (DOM traversal only, no shared IDs, so two instances
// never collide).
function createMiscChecklist(containerEl) {
  containerEl.innerHTML = MISC_ITEMS.map(
    (item, idx) => `
      <div class="misc-row disabled" data-item="${escapeHtml(item)}">
        <label class="misc-checkbox-label">
          <input type="checkbox" class="misc-check" data-idx="${idx}">
          <span>${escapeHtml(item)}</span>
        </label>
        <div class="misc-stepper">
          <button type="button" class="stepper-btn misc-minus" data-idx="${idx}" disabled>−</button>
          <span class="stepper-value">1</span>
          <button type="button" class="stepper-btn misc-plus" data-idx="${idx}" disabled>+</button>
        </div>
      </div>`
  ).join('');

  containerEl.querySelectorAll('.misc-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const row = checkbox.closest('.misc-row');
      const minusBtn = row.querySelector('.misc-minus');
      const plusBtn = row.querySelector('.misc-plus');
      minusBtn.disabled = !checkbox.checked;
      plusBtn.disabled = !checkbox.checked;
      row.classList.toggle('disabled', !checkbox.checked);
      if (!checkbox.checked) {
        row.querySelector('.stepper-value').textContent = '1';
      }
    });
  });

  containerEl.querySelectorAll('.misc-minus').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qtyEl = btn.closest('.misc-row').querySelector('.stepper-value');
      const current = parseInt(qtyEl.textContent, 10);
      if (current > 1) qtyEl.textContent = String(current - 1);
    });
  });

  containerEl.querySelectorAll('.misc-plus').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qtyEl = btn.closest('.misc-row').querySelector('.stepper-value');
      const current = parseInt(qtyEl.textContent, 10);
      qtyEl.textContent = String(current + 1);
    });
  });

  function getCheckedItems() {
    const result = [];
    containerEl.querySelectorAll('.misc-check').forEach((checkbox) => {
      if (checkbox.checked) {
        const idx = checkbox.dataset.idx;
        const amount = parseInt(checkbox.closest('.misc-row').querySelector('.stepper-value').textContent, 10);
        result.push({ item: MISC_ITEMS[idx], amount });
      }
    });
    return result;
  }

  function reset() {
    containerEl.querySelectorAll('.misc-check').forEach((checkbox) => {
      checkbox.checked = false;
      const row = checkbox.closest('.misc-row');
      row.querySelector('.stepper-value').textContent = '1';
      row.classList.add('disabled');
      row.querySelector('.misc-minus').disabled = true;
      row.querySelector('.misc-plus').disabled = true;
    });
  }

  return { getCheckedItems, reset };
}

const borrowMisc = createMiscChecklist(document.getElementById('miscChecklist'));

borrowAddBtn.addEventListener('click', handleBorrowAdd);

// Reserving equipment lets the reserving employee borrow/return it as many
// times as they like within the hold window without releasing it early -
// so an item that's Reserved by whoever is about to do this borrow (self,
// or the on-behalf employee for Admin) is addable here too, not just plain
// Available items.
function isMyActiveReservation(data) {
  const actingId = isAdmin ? borrowOnBehalfInput.value.trim() || employeeId : employeeId;
  return (
    normalizeStatusLabel(data.status) === 'Reserved' &&
    data.employeeId === actingId &&
    Boolean(data.reservedUntil) &&
    new Date(data.reservedUntil).getTime() > Date.now()
  );
}

async function handleBorrowAdd(overrideId) {
  const id = (typeof overrideId === 'string' ? overrideId : borrowInput.value).trim();
  setMessage(borrowMessage, '', null);

  if (!id) {
    setMessage(borrowMessage, 'Enter an Equipment ID first.', 'error');
    return;
  }
  if (borrowCart.some((c) => c.equipmentId === id)) {
    setMessage(borrowMessage, `${idLabel(id)} is already in your cart.`, 'error');
    return;
  }

  try {
    const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok) {
      setMessage(borrowMessage, data.message || 'Equipment not found.', 'error');
      return;
    }

    if (normalizeStatusLabel(data.status) !== 'Available' && !isMyActiveReservation(data)) {
      const borrower = data.employeeName
        ? `${data.employeeName} (${data.employeeId})`
        : data.employeeId || 'another employee';
      setMessage(
        borrowMessage,
        `"${data.item}"${idSuffix(data.equipmentId)} is currently borrowed by ${borrower}. Please select another item.`,
        'error'
      );
      return;
    }

    borrowCart.push({ equipmentId: data.equipmentId, item: data.item, comment: data.comment });
    borrowInput.value = '';
    setMessage(borrowMessage, `Added "${data.item}"${idSuffix(data.equipmentId)} to cart.`, 'success');
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
        ${idCell(c.equipmentId)}
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

  const miscItems = borrowMisc.getCheckedItems();

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

  // Admin can borrow on behalf of any employee via the extra ID field that
  // only appears for the Admin account - everyone else always borrows as
  // themselves.
  let actingEmployeeId = employeeId;
  if (isAdmin) {
    const onBehalfId = borrowOnBehalfInput.value.trim();
    if (!onBehalfId) {
      setMessage(borrowStatusMessage, 'Enter the Employee ID to borrow on behalf of.', 'error');
      return;
    }
    actingEmployeeId = onBehalfId;
  }

  const itemCount = borrowCart.length + miscItems.length;
  const confirmed = await askConfirm(
    `Complete this borrow of ${itemCount} item${itemCount === 1 ? '' : 's'}? The selected equipment will be marked as unavailable.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/borrow/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: actingEmployeeId,
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
            return `${conflictLabel(borrowCart, c.equipmentId)} is now borrowed by ${c.borrowerId}.`;
          }
          return `${conflictLabel(borrowCart, c.equipmentId)} was not found.`;
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
    if (isAdmin) borrowOnBehalfInput.value = '';
    renderBorrowCart();
    borrowMisc.reset();
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

// This field only accepts a physical barcode scanner's input, never manual
// keyboard typing - see bindScanOnlyInput. Deliberately NOT hooked up to the
// keyword suggestion dropdown either (unlike Borrow/Reserve) - no name
// search here. handleReturnAdd() below always does an exact equipmentId
// lookup via GET /api/equipment/:id, so whatever's scanned only ever matches
// that one specific ID - never a fuzzy/partial or item-name match.
bindScanOnlyInput(returnInput, (scanned) => handleReturnAdd(scanned));
returnAddBtn.addEventListener('click', handleReturnAdd);

async function handleReturnAdd(overrideId) {
  const id = (typeof overrideId === 'string' ? overrideId : returnInput.value).trim();
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

    const returnStatusLabel = normalizeStatusLabel(data.status);
    if (returnStatusLabel !== 'Unavailable') {
      const reason =
        returnStatusLabel === 'Reserved'
          ? 'is only reserved (not checked out) - use Cancel Reservation on the My Items tab to release it early'
          : 'is not currently checked out';
      setMessage(returnMessage, `"${data.item}"${idSuffix(data.equipmentId)} ${reason}.`, 'error');
      return;
    }

    returnCart.push({
      equipmentId: data.equipmentId,
      item: data.item,
      borrowerId: data.employeeName ? `${data.employeeName} (${data.employeeId})` : data.employeeId
    });
    returnInput.value = '';
    setMessage(returnMessage, `Added "${data.item}"${idSuffix(data.equipmentId)} to return cart.`, 'success');
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
        ${idCell(c.equipmentId)}
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

  const confirmed = await askConfirm(
    `Complete this return of ${returnCart.length} item${returnCart.length === 1 ? '' : 's'}? The selected equipment will be marked as available again.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/return/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ equipmentIds: returnCart.map((c) => c.equipmentId) })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.invalid) {
        const lines = data.invalid.map((c) => `${conflictLabel(returnCart, c.equipmentId)} (${c.reason.replace('_', ' ')})`);
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
// RESERVE TAB
// =======================================================
// Reserving equipment doesn't check it out the way Borrow does - it just
// flags it (yellow "Reserved" tag) as held for a future date/event. The
// Return tab is what releases a reservation back to Available later.
let reserveCart = []; // { equipmentId, item, comment }

const reserveInput = document.getElementById('reserveInput');
const reserveAddBtn = document.getElementById('reserveAddBtn');
const reserveMessage = document.getElementById('reserveMessage');
const reserveCartBody = document.getElementById('reserveCartBody');
const reserveCompleteBtn = document.getElementById('reserveCompleteBtn');
const reserveStatusMessage = document.getElementById('reserveStatusMessage');
const reservePurposeSelect = document.getElementById('reservePurposeSelect');
const reserveEventInput = document.getElementById('reserveEventInput');
const reserveStartDateInput = document.getElementById('reserveStartDateInput');
const reserveStartTimeInput = document.getElementById('reserveStartTimeInput');
const reserveEndDateInput = document.getElementById('reserveEndDateInput');
const reserveEndTimeInput = document.getElementById('reserveEndTimeInput');
const reserveOnBehalfInput = document.getElementById('reserveOnBehalfInput');
const reserveMisc = createMiscChecklist(document.getElementById('miscChecklistReserve'));

// Picking a date defaults its time to the start/end of that day (12:00 AM /
// 11:59 PM) so a reservation can be made with just two date picks - the time
// fields stay fully editable afterward for anyone who wants a precise hour.
reserveStartDateInput.addEventListener('change', () => {
  if (reserveStartDateInput.value && !reserveStartTimeInput.value) {
    reserveStartTimeInput.value = '00:00';
  }
});
reserveEndDateInput.addEventListener('change', () => {
  if (reserveEndDateInput.value && !reserveEndTimeInput.value) {
    reserveEndTimeInput.value = '23:59';
  }
});

reserveAddBtn.addEventListener('click', handleReserveAdd);

async function handleReserveAdd(overrideId) {
  const id = (typeof overrideId === 'string' ? overrideId : reserveInput.value).trim();
  setMessage(reserveMessage, '', null);

  if (!id) {
    setMessage(reserveMessage, 'Enter an Equipment ID first.', 'error');
    return;
  }
  if (reserveCart.some((c) => c.equipmentId === id)) {
    setMessage(reserveMessage, `${idLabel(id)} is already in your cart.`, 'error');
    return;
  }

  try {
    const res = await fetch(`/api/equipment/${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok) {
      setMessage(reserveMessage, data.message || 'Equipment not found.', 'error');
      return;
    }

    const reserveStatusLabel = normalizeStatusLabel(data.status);
    const pendingActive = data.pendingReservation && new Date(data.pendingReservation.end).getTime() > Date.now();
    if (reserveStatusLabel !== 'Available') {
      let reason;
      if (reserveStatusLabel === 'Reserved') {
        reason = `is already reserved${data.event ? ` for "${data.event}"` : ''}${data.reservedUntil ? ` until ${formatDateTime(data.reservedUntil)}` : ''}`;
      } else {
        const borrower = data.employeeName
          ? `${data.employeeName} (${data.employeeId})`
          : data.employeeId || 'another employee';
        reason = `is currently borrowed by ${borrower}`;
      }
      setMessage(reserveMessage, `"${data.item}"${idSuffix(data.equipmentId)} ${reason}. Please select another item.`, 'error');
      return;
    }
    if (pendingActive) {
      setMessage(
        reserveMessage,
        `"${data.item}"${idSuffix(data.equipmentId)} already has an upcoming reservation${
          data.pendingReservation.event ? ` for "${data.pendingReservation.event}"` : ''
        } starting ${formatDateTime(data.pendingReservation.start)}. Please select another item.`,
        'error'
      );
      return;
    }

    reserveCart.push({ equipmentId: data.equipmentId, item: data.item, comment: data.comment });
    reserveInput.value = '';
    setMessage(reserveMessage, `Added "${data.item}"${idSuffix(data.equipmentId)} to cart.`, 'success');
    renderReserveCart();
  } catch (err) {
    setMessage(reserveMessage, 'Could not reach the server.', 'error');
  }
}

function renderReserveCart() {
  if (reserveCart.length === 0) {
    reserveCartBody.innerHTML = '<tr class="empty-row"><td colspan="4">No equipment added yet.</td></tr>';
    return;
  }
  reserveCartBody.innerHTML = reserveCart
    .map(
      (c, idx) => `
      <tr>
        ${idCell(c.equipmentId)}
        <td>${escapeHtml(c.item)}</td>
        <td>${escapeHtml(c.comment) || '-'}</td>
        <td><button class="remove-btn" data-idx="${idx}" type="button">Remove</button></td>
      </tr>`
    )
    .join('');

  reserveCartBody.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      reserveCart.splice(Number(btn.dataset.idx), 1);
      renderReserveCart();
    });
  });
}

reserveCompleteBtn.addEventListener('click', async () => {
  setMessage(reserveStatusMessage, '', null);

  const miscItems = reserveMisc.getCheckedItems();

  if (reserveCart.length === 0 && miscItems.length === 0) {
    setMessage(reserveStatusMessage, 'Add at least one item before completing.', 'error');
    return;
  }

  const purpose = reservePurposeSelect.value;
  if (reserveCart.length > 0 && !purpose) {
    setMessage(reserveStatusMessage, 'Select a Purpose before completing the reservation.', 'error');
    return;
  }

  const eventValue = reserveEventInput.value.trim();
  if (reserveCart.length > 0 && !eventValue) {
    setMessage(reserveStatusMessage, 'Enter an Event before completing the reservation.', 'error');
    return;
  }

  const startDateValue = reserveStartDateInput.value;
  const startTimeValue = reserveStartTimeInput.value;
  const endDateValue = reserveEndDateInput.value;
  const endTimeValue = reserveEndTimeInput.value;
  if (reserveCart.length > 0 && (!startDateValue || !startTimeValue || !endDateValue || !endTimeValue)) {
    setMessage(reserveStatusMessage, 'Select a start and end date/time before completing the reservation.', 'error');
    return;
  }
  if (reserveCart.length > 0) {
    const startCheck = new Date(`${startDateValue}T${startTimeValue}`);
    const endCheck = new Date(`${endDateValue}T${endTimeValue}`);
    if (endCheck.getTime() <= startCheck.getTime()) {
      setMessage(reserveStatusMessage, 'The end date/time must be after the start date/time.', 'error');
      return;
    }
  }

  // Admin can reserve on behalf of any employee via the extra ID field that
  // only appears for the Admin account - everyone else always reserves as
  // themselves.
  let actingEmployeeId = employeeId;
  if (isAdmin) {
    const onBehalfId = reserveOnBehalfInput.value.trim();
    if (!onBehalfId) {
      setMessage(reserveStatusMessage, 'Enter the Employee ID to reserve on behalf of.', 'error');
      return;
    }
    actingEmployeeId = onBehalfId;
  }

  const reserveItemCount = reserveCart.length + miscItems.length;
  const confirmed = await askConfirm(
    `Complete this reservation of ${reserveItemCount} item${reserveItemCount === 1 ? '' : 's'}? If the start is in the future, the item stays available to everyone until then.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/reserve/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: actingEmployeeId,
        purpose: purpose || null,
        event: eventValue || null,
        startDate: startDateValue || null,
        startTime: startTimeValue || null,
        endDate: endDateValue || null,
        endTime: endTimeValue || null,
        equipmentIds: reserveCart.map((c) => c.equipmentId),
        miscItems
      })
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.conflicts) {
        const lines = data.conflicts.map((c) => {
          if (c.reason === 'pending_reservation') {
            return `${conflictLabel(reserveCart, c.equipmentId)} already has an upcoming reservation from ${c.borrowerId}.`;
          }
          if (c.reason === 'unavailable') {
            return `${conflictLabel(reserveCart, c.equipmentId)} is no longer available.`;
          }
          return `${conflictLabel(reserveCart, c.equipmentId)} was not found.`;
        });
        setMessage(reserveStatusMessage, `${data.message} ${lines.join(' ')}`, 'error');
      } else {
        setMessage(reserveStatusMessage, data.message || 'Could not complete the reservation.', 'error');
      }
      return;
    }

    setMessage(reserveStatusMessage, data.message || 'Reservation completed successfully.', 'success');
    reserveCart = [];
    reservePurposeSelect.value = '';
    reserveEventInput.value = '';
    reserveStartDateInput.value = '';
    reserveStartTimeInput.value = '';
    reserveEndDateInput.value = '';
    reserveEndTimeInput.value = '';
    if (isAdmin) reserveOnBehalfInput.value = '';
    renderReserveCart();
    reserveMisc.reset();
  } catch (err) {
    setMessage(reserveStatusMessage, 'Could not reach the server.', 'error');
  }
});

// =======================================================
// KEYWORD SUGGESTION DROPDOWN (Borrow & Reserve only - never Return)
// =======================================================
// Typing an Equipment ID or item name keyword into the Borrow/Reserve inputs
// shows a dropdown of matches (built from the already-loaded inventory
// list) so people don't have to remember/type the exact ID. Deliberately
// left off the Return tab - Return is barcode-scan only so a return always
// matches a physical item actually in hand.
// Computes the availability badge/clickability shown per suggestion row.
// actingId is whoever will actually receive the added item - self, or the
// on-behalf employeeId for Admin - matching isMyActiveReservation's own
// definition of "mine" above. Five outcomes, matching how Borrow/Reserve are
// meant to behave from the suggestion dropdown:
//   - Available (no pending claim either): clickable, adds normally.
//   - Unavailable (someone has it checked out): not clickable.
//   - Actively Reserved by someone else (on the shelf, awaiting their
//     pickup): not clickable.
//   - Actively Reserved by the acting employee themselves: clickable (lets
//     them pick up their own reservation from here too).
//   - Not currently held by anyone, but already has a future/pending
//     reservation from someone else: still clickable - the item is
//     genuinely Available right now, the future hold just hasn't started.
function suggestAvailability(it, actingId) {
  const statusLabel = normalizeStatusLabel(it.status);

  if (statusLabel === 'Unavailable') {
    return { label: 'Unavailable', cssClass: 'suggest-unavailable', clickable: false };
  }

  const reservedActive =
    statusLabel === 'Reserved' && Boolean(it.reservedUntil) && new Date(it.reservedUntil).getTime() > Date.now();
  if (reservedActive) {
    if (it.employeeId === actingId) {
      return { label: 'Reserved (yours)', cssClass: 'suggest-reserved-mine', clickable: true };
    }
    return { label: 'Reserved', cssClass: 'suggest-reserved', clickable: false };
  }

  const pendingUnexpired =
    Boolean(it.pendingReservation) && new Date(it.pendingReservation.end).getTime() > Date.now();
  if (pendingUnexpired) {
    return { label: 'Reserved (upcoming)', cssClass: 'suggest-upcoming', clickable: true };
  }

  return { label: 'Available', cssClass: 'suggest-available', clickable: true };
}

function setupSuggestDropdown(inputEl, listEl, { getCandidates, getAvailability, onPick, onEnterFallback }) {
  let items = [];
  let activeIdx = -1;

  function render(query) {
    items = getCandidates(query);
    if (items.length === 0) {
      listEl.innerHTML = query ? '<div class="suggest-empty">No matching equipment.</div>' : '';
      listEl.classList.toggle('hidden', !query);
      activeIdx = -1;
      return;
    }
    listEl.innerHTML = items
      .map((it, idx) => {
        const avail = getAvailability(it);
        return `
        <div class="suggest-item${avail.clickable ? '' : ' suggest-item-blocked'}" data-idx="${idx}">
          <span class="suggest-main">
            <span class="suggest-id">${escapeHtml(it.equipmentId)}</span>
            <span class="suggest-name">${escapeHtml(it.item)}</span>
          </span>
          <span class="suggest-status ${avail.cssClass}">${escapeHtml(avail.label)}</span>
        </div>`;
      })
      .join('');
    listEl.classList.remove('hidden');
    activeIdx = -1;
    listEl.querySelectorAll('.suggest-item').forEach((el) => {
      // mousedown (not click) fires before the input's blur, so the pick
      // still runs while the dropdown is visible/selectable.
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(Number(el.dataset.idx));
      });
    });
  }

  function highlight() {
    listEl.querySelectorAll('.suggest-item').forEach((el, idx) => {
      el.classList.toggle('active', idx === activeIdx);
    });
  }

  function pick(idx) {
    const chosen = items[idx];
    if (!chosen) return;
    // Unavailable / actively-reserved-by-someone-else rows are shown for
    // context but do nothing when clicked/selected - only hide (and add)
    // once we know this one is actually pickable.
    if (!getAvailability(chosen).clickable) return;
    hide();
    onPick(chosen);
  }

  function hide() {
    listEl.classList.add('hidden');
    listEl.innerHTML = '';
    items = [];
    activeIdx = -1;
  }

  inputEl.addEventListener('input', () => render(inputEl.value.trim()));
  inputEl.addEventListener('focus', () => {
    if (inputEl.value.trim()) render(inputEl.value.trim());
  });
  inputEl.addEventListener('blur', () => {
    // Delay so a mousedown-triggered pick() above still gets to run first.
    setTimeout(hide, 150);
  });
  inputEl.addEventListener('keydown', (e) => {
    const visible = !listEl.classList.contains('hidden') && items.length > 0;
    if (e.key === 'ArrowDown' && visible) {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      highlight();
    } else if (e.key === 'ArrowUp' && visible) {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      highlight();
    } else if (e.key === 'Escape') {
      hide();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible) {
        pick(activeIdx >= 0 ? activeIdx : 0);
      } else {
        onEnterFallback();
      }
    }
  });
}

function equipmentLabelMatches(it, query) {
  return `${it.equipmentId} ${it.item} ${it.category || ''}`.toLowerCase().includes(query.toLowerCase());
}

setupSuggestDropdown(borrowInput, document.getElementById('borrowSuggestList'), {
  getCandidates: (query) => {
    if (!query) return [];
    // Every matching item is shown regardless of availability now - the
    // status badge (see suggestAvailability) and disabled look tell people
    // apart from Available ones, rather than hiding them entirely.
    return inventoryItems
      .filter((it) => !borrowCart.some((c) => c.equipmentId === it.equipmentId))
      .filter((it) => equipmentLabelMatches(it, query));
  },
  getAvailability: (it) =>
    suggestAvailability(it, isAdmin ? borrowOnBehalfInput.value.trim() || employeeId : employeeId),
  onPick: (item) => {
    // Non-admin picked this by name/category, not by already knowing its ID -
    // so the box shows the item name back, never the raw ID, while the real
    // ID is still what gets added under the hood.
    borrowInput.value = isAdmin ? item.equipmentId : item.item;
    handleBorrowAdd(isAdmin ? undefined : item.equipmentId);
  },
  onEnterFallback: handleBorrowAdd
});

setupSuggestDropdown(reserveInput, document.getElementById('reserveSuggestList'), {
  getCandidates: (query) => {
    if (!query) return [];
    return inventoryItems
      .filter((it) => !reserveCart.some((c) => c.equipmentId === it.equipmentId))
      .filter((it) => equipmentLabelMatches(it, query));
  },
  getAvailability: (it) =>
    suggestAvailability(it, isAdmin ? reserveOnBehalfInput.value.trim() || employeeId : employeeId),
  onPick: (item) => {
    // Non-admin picked this by name/category, not by already knowing its ID -
    // so the box shows the item name back, never the raw ID, while the real
    // ID is still what gets added under the hood.
    reserveInput.value = isAdmin ? item.equipmentId : item.item;
    handleReserveAdd(isAdmin ? undefined : item.equipmentId);
  },
  onEnterFallback: handleReserveAdd
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

// ---------- Admin-only: CSV import ----------
// Adds new equipment (never updates existing rows) from a CSV file with
// additionalInfo, comment, employeeId, equipmentId, item, and status
// columns required, plus optional ports, location, and category columns.
const importCsvBtn = document.getElementById('importCsvBtn');
const importCsvFile = document.getElementById('importCsvFile');
const importResultMessage = document.getElementById('importResultMessage');

if (importCsvBtn) {
  importCsvBtn.addEventListener('click', () => importCsvFile.click());
}

if (importCsvFile) {
  importCsvFile.addEventListener('change', async () => {
    const file = importCsvFile.files[0];
    importCsvFile.value = ''; // reset so selecting the same file again still fires "change"
    if (!file) return;

    setMessage(importResultMessage, 'Importing…', null);

    try {
      const csvText = await file.text();
      const res = await fetch('/api/equipment/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText, requesterId: employeeId })
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(importResultMessage, data.message || 'Could not import that CSV file.', 'error');
        return;
      }

      setMessage(importResultMessage, data.message, 'success');
      await loadInventory();
    } catch (err) {
      setMessage(importResultMessage, 'Could not reach the server.', 'error');
    }
  });
}

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
      textMatches(i.location, inventoryFilters.location) &&
      textMatches(i.item, inventoryFilters.item) &&
      // Case-insensitive: some existing inventory rows have status stored
      // in uppercase (AVAILABLE/UNAVAILABLE/RESERVED) while the app's own
      // borrow/return/reserve actions write proper case (Available/...) -
      // both need to match the same filter selection.
      (!inventoryFilters.status || String(i.status || '').toLowerCase() === inventoryFilters.status) &&
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

  const STATUS_OPTIONS = ['Available', 'Unavailable', 'Reserved'];

  // Plain admin text-field cell: same look as the Comment/Additional Info
  // inputs, but wired to the admin-only PATCH .../field endpoint instead.
  function adminField(equipmentId, field, value, placeholder, title) {
    return `
      <input
        type="text"
        class="comment-input admin-field"
        data-equipment-id="${escapeHtml(equipmentId)}"
        data-field="${field}"
        value="${escapeHtml(value || '')}"
        placeholder="${escapeHtml(placeholder || '')}"
        ${title ? `title="${escapeHtml(title)}"` : ''}
      >`;
  }

  inventoryBody.innerHTML = items
    .map((i) => {
      const statusLabel = normalizeStatusLabel(i.status);
      const pillClass =
        statusLabel === 'Available' ? 'status-available' : statusLabel === 'Reserved' ? 'status-reserved' : 'status-unavailable';
      const borrower = i.employeeId ? `${escapeHtml(i.employeeName)} (${escapeHtml(i.employeeId)})` : '-';
      const lastBorrower = i.lastBorrowedBy
        ? `${escapeHtml(i.lastBorrowedByName)} (${escapeHtml(i.lastBorrowedBy)})`
        : '-';

      // Admin gets every cell as an editable control; everyone else keeps
      // the existing read-only display (Comment/Additional Info stay
      // editable for all users, unchanged).
      // The Equipment ID itself isn't shown here anymore - Location takes
      // its place as the lead column, since browsing inventory by physical
      // location is more useful than by ID (the ID lives on the item's own
      // barcode, scanned directly at Borrow/Return/Reserve time). The ID is
      // only ever surfaced to Admin, as a hover tooltip on this cell -
      // everyone else sees Location alone, no ID anywhere, not even on hover.
      const locationCell = isAdmin
        ? adminField(i.equipmentId, 'location', i.location, 'Location', `Equipment ID: ${i.equipmentId}`)
        : `<span class="tag-chip">${escapeHtml(i.location) || '-'}</span>`;
      const itemCell = isAdmin ? adminField(i.equipmentId, 'item', i.item) : escapeHtml(i.item);
      // A reservation hold (reservedUntil) can be active while the item is
      // physically checked out (status Unavailable, from the reserving
      // employee borrowing it mid-window). Rather than one pill trying to
      // say both things at once, show the base Available/Unavailable status
      // and a separate "Reserved" badge beside it whenever that's the case.
      const reservationActive = Boolean(i.reservedUntil) && new Date(i.reservedUntil).getTime() > Date.now();
      const showReservedBadge = statusLabel === 'Unavailable' && reservationActive;
      const reservedBadge = showReservedBadge
        ? `<span class="status-pill status-reserved-badge" title="${escapeHtml(i.event || '')}">Reserved${
            i.event ? ` · ${escapeHtml(i.event)}` : ''
          } until ${formatDateTime(i.reservedUntil)}</span>`
        : '';
      // A pending (future-start) reservation doesn't change status at all -
      // the item stays Available for anyone to borrow/reserve in the
      // meantime - but it's still worth flagging here so it doesn't look
      // like this Available item is free indefinitely.
      const pendingActive = Boolean(i.pendingReservation) && new Date(i.pendingReservation.end).getTime() > Date.now();
      const upcomingBadge = pendingActive
        ? `<span class="status-pill status-upcoming-badge" title="${escapeHtml(i.pendingReservation.event || '')}">Upcoming${
            i.pendingReservation.event ? ` · ${escapeHtml(i.pendingReservation.event)}` : ''
          } from ${formatDateTime(i.pendingReservation.start)}</span>`
        : '';
      const baseStatusControl = isAdmin
        ? `<select class="comment-input admin-field admin-select" data-equipment-id="${escapeHtml(i.equipmentId)}" data-field="status">
            ${STATUS_OPTIONS.map(
              (opt) => `<option value="${opt}" ${opt === statusLabel ? 'selected' : ''}>${opt}</option>`
            ).join('')}
          </select>`
        : `<span class="status-pill ${pillClass}">${escapeHtml(statusLabel)}</span>`;
      const statusCell = `<div class="status-cell-group">${baseStatusControl}${reservedBadge}${upcomingBadge}</div>`;
      const borrowedByCell = isAdmin
        ? adminField(i.equipmentId, 'employeeId', i.employeeId, 'Employee ID')
        : borrower;
      const eventCell = isAdmin ? adminField(i.equipmentId, 'event', i.event, 'Event') : escapeHtml(i.event) || '-';
      const lastBorrowedByCell = isAdmin
        ? adminField(i.equipmentId, 'lastBorrowedBy', i.lastBorrowedBy, 'Employee ID')
        : lastBorrower;
      const lastBorrowedAtCell = isAdmin
        ? adminField(
            i.equipmentId,
            'lastBorrowedAt',
            i.lastBorrowedAt ? new Date(i.lastBorrowedAt).toISOString().slice(0, 10) : '',
            'YYYY-MM-DD'
          )
        : formatDateTime(i.lastBorrowedAt);

      return `
      <tr>
        <td>${locationCell}</td>
        <td>${itemCell}</td>
        <td>${statusCell}</td>
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
        <td>${borrowedByCell}</td>
        <td>${eventCell}</td>
        <td>${lastBorrowedByCell}</td>
        <td>${lastBorrowedAtCell}</td>
      </tr>`;
    })
    .join('');

  // Comment/Additional Information: unchanged, open to every user.
  inventoryBody.querySelectorAll('.comment-input[data-endpoint]').forEach((input) => {
    input.dataset.original = input.value;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
    input.addEventListener('blur', () => saveEditableField(input));
  });

  // Every other cell: Admin-only, hits the generic field-edit endpoint.
  if (isAdmin) {
    inventoryBody.querySelectorAll('.admin-field').forEach((input) => {
      input.dataset.original = input.value;
      if (input.tagName === 'SELECT') {
        input.addEventListener('change', () => saveAdminField(input));
      } else {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        });
        input.addEventListener('blur', () => saveAdminField(input));
      }
    });
  }
}

// Admin-only counterpart to saveEditableField() above - saves any inventory
// cell via PATCH /api/equipment/:id/field, then reloads the whole table
// since editing a field like equipmentId or status can change how other
// rows/cells should display (borrower names, tag chips, etc.).
async function saveAdminField(input) {
  const newValue = input.value.trim();
  if (newValue === input.dataset.original) return;

  const equipmentId = input.dataset.equipmentId;
  const field = input.dataset.field;
  input.disabled = true;
  setMessage(inventoryMessage, '', null);

  try {
    const res = await fetch(`/api/equipment/${encodeURIComponent(equipmentId)}/field`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value: newValue, requesterId: employeeId })
    });
    const data = await res.json();

    if (!res.ok) {
      input.value = input.dataset.original;
      input.disabled = false;
      flashCommentInput(input, false);
      setMessage(inventoryMessage, data.message || `Could not save changes for ${equipmentId}.`, 'error');
      return;
    }

    setMessage(inventoryMessage, 'Saved.', 'success');
    await loadInventory();
  } catch (err) {
    input.value = input.dataset.original;
    input.disabled = false;
    flashCommentInput(input, false);
    setMessage(inventoryMessage, 'Could not reach the server.', 'error');
  }
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
      const match = inventoryItems.find((it) => it.equipmentId === equipmentId);
      const label = isAdmin ? equipmentId : match ? `"${match.item}"` : 'that item';
      setMessage(inventoryMessage, data.message || `Could not save changes for ${label}.`, 'error');
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
loadMyItems();

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
const scanReserveBtn = document.getElementById('scanReserveBtn');
const scannerModal = document.getElementById('scannerModal');
const scannerCloseBtn = document.getElementById('scannerCloseBtn');
const scannerError = document.getElementById('scannerError');
let activeScanner = null;
let scanTarget = null; // { input, handler } - which tab requested the scan

scanBorrowBtn.addEventListener('click', () => startScanner(borrowInput, handleBorrowAdd));
scanReturnBtn.addEventListener('click', () => startScanner(returnInput, handleReturnAdd));
scanReserveBtn.addEventListener('click', () => startScanner(reserveInput, handleReserveAdd));
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
  const scanConfig = { fps: 10, qrbox: { width: 260, height: 160 } }; // draws the scan-box outline

  try {
    // Prefer the back/rear camera when available, and ask for a higher
    // resolution feed - barcodes are small and low-res video makes them
    // much harder to decode, especially on laptop webcams.
    await activeScanner.start(
      { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      scanConfig,
      onScanSuccess,
      () => {} // per-frame "nothing found yet" callback - ignore and keep scanning
    );
  } catch (err) {
    console.warn('Camera start failed with a resolution hint, retrying with a plain camera request:', err);
    // Html5Qrcode doesn't support calling start() a second time on the same
    // instance that already failed once - retrying on it produces a vague,
    // unhelpful error that masks the real one above. Use a fresh instance.
    try {
      activeScanner.clear();
    } catch (cleanupErr) {
      // ignore - the failed instance may not have anything to clean up
    }
    activeScanner = new Html5Qrcode('scannerViewport');
    try {
      await activeScanner.start({ facingMode: 'environment' }, scanConfig, onScanSuccess, () => {});
    } catch (err2) {
      console.error('Camera start failed on retry too:', err2);
      scannerError.textContent = `Could not access the camera: ${err2.name || 'Error'}${err2.message ? ' - ' + err2.message : ''}`;
    }
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
