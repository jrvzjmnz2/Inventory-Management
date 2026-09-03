// ---------- Auth guard ----------
// The server only ever sends this page to a browser that already presented
// a valid session cookie (see requirePageSession in server.js) and embeds
// that verified identity as window.__SESSION__ right before this script
// tag. Reading it here (instead of a client-writable store like
// sessionStorage) means this can't be spoofed by editing browser storage -
// the real gate already ran server-side before any of this HTML was sent.
// The server only ever serves this page after confirming a real session
// (requirePageSession + requireLiveEmployee in server.js), so
// window.__SESSION__ itself is always present here - checking THAT (not
// employeeId specifically) is what decides "not actually logged in". A
// Microsoft sign-in that hasn't been tagged with an employeeId yet is still
// a perfectly valid, logged-in session; bouncing it back to '/' here would
// just redirect straight back to this same page (server.js sends any valid
// session to /dashboard.html) - an infinite loop.
if (!window.__SESSION__) {
  window.location.href = '/';
}

const employeeId = window.__SESSION__ && window.__SESSION__.employeeId;
const employeeName = window.__SESSION__ && window.__SESSION__.name;

if (!employeeId) {
  document.getElementById('pendingSetupBanner').classList.remove('hidden');
}

document.getElementById('welcomeText').textContent = employeeId
  ? `${employeeName} (${employeeId})`
  : `${employeeName} (pending setup)`;

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

// This used to log the employee out of this app entirely. Now it's just a
// way back to the Hub - it leaves this app's own session alone, so if the
// same person opens Equipment Inventory again later today (directly, or by
// clicking its tile on the Hub), they land straight back on this dashboard
// rather than having to sign in again.
document.getElementById('returnToHubBtn').addEventListener('click', () => {
  window.location.href = window.__HUB_URL__ || '/';
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
    if (btn.dataset.tab === 'request') {
      // The Borrow start is "now", and step 2's availability badges go
      // stale as soon as someone else borrows something - both are worth
      // re-reading whenever this tab comes back into view.
      refreshBorrowStartLabel();
      if (requestStep === 2) loadInventory();
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

// Same on-screen-only "notification" idea as pendingReturnWarning above, but
// for the borrower's own Borrow Until due date/time (set on the Borrow tab
// when the item was checked out) rather than someone else's reservation.
// Fires once 12 hours or less remain before the due date/time - also covers
// the item already being overdue, just worded differently.
function borrowDueWarning(i) {
  if (!i.borrowUntil) return null;
  const dueMs = new Date(i.borrowUntil).getTime();
  const hoursUntilDue = (dueMs - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilDue > 12) return null;
  return { due: i.borrowUntil, overdue: hoursUntilDue <= 0 };
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
  // Reserved rows show the hold's expiration; borrowed (Unavailable) rows
  // show the Borrow Until due date/time instead, when one was set.
  const heldUntil = statusLabel === 'Reserved'
    ? (i.reservedUntil ? formatDateTime(i.reservedUntil) : '-')
    : (i.borrowUntil ? formatDateTime(i.borrowUntil) : '-');

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
  const dueWarning = statusLabel === 'Unavailable' ? borrowDueWarning(i) : null;
  const warningRows = `${
    warning
      ? `<tr class="my-items-warning-row"><td colspan="5">Please return "${escapeHtml(i.item)}" by ${formatDateTime(warning.start)} - it's reserved${warning.event ? ` for "${escapeHtml(warning.event)}"` : ''} starting then.</td></tr>`
      : ''
  }${
    dueWarning
      ? `<tr class="my-items-warning-row"><td colspan="5">${
          dueWarning.overdue
            ? `"${escapeHtml(i.item)}" is past its Borrow Until time. Please return it as soon as possible.`
            : `Please return "${escapeHtml(i.item)}" soon.`
        }</td></tr>`
      : ''
  }`;

  return `
  <tr>
    ${homeIdCell(i.equipmentId)}
    <td>${escapeHtml(i.item)}</td>
    <td><span class="status-pill ${pillClass}">${escapeHtml(statusLabel)}</span></td>
    <td>${heldUntil}</td>
    <td class="action-row">${actionsHtml}</td>
  </tr>${warningRows
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
    .map(([eventName, groupItems]) => {
      // Pending (not-yet-started) items don't count towards either of
      // these - there's nothing to borrow or reschedule on them yet, just
      // the Cancel option already offered on their own row.
      const activeItems = groupItems.filter((i) => !i.isPending);
      const reservedItems = activeItems.filter((i) => normalizeStatusLabel(i.status) === 'Reserved');
      const hasReservedToBorrow = reservedItems.length > 0;
      // "All reserved" = every active item in this event is still sitting
      // on the shelf, on-hold but never picked up - none checked out yet.
      const allReserved = activeItems.length > 0 && reservedItems.length === activeItems.length;
      const reservedIdsAttr = reservedItems.map((i) => i.equipmentId).join(',');
      // Prefills the reschedule form with the earliest current end among
      // the group, so "changing" the date starts from something real.
      const currentEnd = reservedItems.length
        ? reservedItems.reduce(
            (min, i) => (new Date(i.reservedUntil).getTime() < new Date(min).getTime() ? i.reservedUntil : min),
            reservedItems[0].reservedUntil
          )
        : null;
      // Anything with a reservation left to cancel/end: still pending
      // (not started), sitting Reserved on the shelf, or checked out but
      // still under an active hold - matches exactly what gets an
      // individual Cancel/End Reservation button on its own row below.
      const cancellableItems = groupItems.filter((i) => {
        if (i.isPending) return true;
        const statusLabel = normalizeStatusLabel(i.status);
        if (statusLabel === 'Reserved') return true;
        if (statusLabel === 'Unavailable') {
          return Boolean(i.reservedUntil) && new Date(i.reservedUntil).getTime() > Date.now();
        }
        return false;
      });
      const hasCancellable = cancellableItems.length > 0;
      const cancellableIdsAttr = cancellableItems.map((i) => i.equipmentId).join(',');

      return `<tr class="event-section-header">
          <td colspan="4">${escapeHtml(eventName)}</td>
          <td class="action-row">
            ${
              hasReservedToBorrow
                ? `<button class="secondary-btn event-borrow-all-btn" data-event="${escapeHtml(eventName)}" data-equipment-ids="${escapeHtml(reservedIdsAttr)}" type="button">Borrow All</button>`
                : ''
            }
            ${
              allReserved
                ? `<button class="secondary-btn event-reschedule-btn" data-event="${escapeHtml(eventName)}" type="button">Change Reservation Date</button>`
                : ''
            }
            ${
              hasCancellable
                ? `<button class="remove-btn event-cancel-all-btn" data-event="${escapeHtml(eventName)}" data-equipment-ids="${escapeHtml(cancellableIdsAttr)}" type="button">Remove All Reservations</button>`
                : ''
            }
            <button class="secondary-btn event-list-btn" data-event="${escapeHtml(eventName)}" type="button">Create Equipment List</button>
          </td>
        </tr>${
          allReserved
            ? `<tr class="event-reschedule-row hidden" data-event="${escapeHtml(eventName)}" data-equipment-ids="${escapeHtml(reservedIdsAttr)}">
                <td colspan="5">
                  <div class="input-row">
                    <input type="date" class="event-reschedule-end-date" value="${currentEnd ? toLocalDateInputValue(currentEnd) : ''}">
                    <input type="time" class="event-reschedule-end-time" value="${currentEnd ? toLocalTimeInputValue(currentEnd) : ''}">
                    <button class="secondary-btn event-reschedule-save-btn" type="button">Save New Date</button>
                    <button class="remove-btn event-reschedule-cancel-btn" type="button">Cancel</button>
                  </div>
                </td>
              </tr>`
            : ''
        }${groupItems.map(renderMyItemRow).join('')}`;
    })
    .join('');

  homeBody.querySelectorAll('.event-list-btn').forEach((btn) => {
    btn.addEventListener('click', () => createEventEquipmentList(btn.dataset.event));
  });
  homeBody.querySelectorAll('.event-borrow-all-btn').forEach((btn) => {
    const ids = btn.dataset.equipmentIds ? btn.dataset.equipmentIds.split(',').filter(Boolean) : [];
    btn.addEventListener('click', () => homeBorrowAll(btn.dataset.event, ids));
  });
  homeBody.querySelectorAll('.event-cancel-all-btn').forEach((btn) => {
    const ids = btn.dataset.equipmentIds ? btn.dataset.equipmentIds.split(',').filter(Boolean) : [];
    btn.addEventListener('click', () => homeCancelAll(btn.dataset.event, ids));
  });
  homeBody.querySelectorAll('.event-reschedule-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      // The reschedule row is always the very next sibling of this header
      // row (see the template above), so this doesn't need any selector
      // that could break on an event name with unusual characters.
      const row = btn.closest('tr').nextElementSibling;
      if (row && row.classList.contains('event-reschedule-row')) {
        row.classList.toggle('hidden');
      }
    });
  });
  homeBody.querySelectorAll('.event-reschedule-cancel-btn').forEach((btn) => {
    btn.addEventListener('click', () => btn.closest('tr').classList.add('hidden'));
  });
  homeBody.querySelectorAll('.event-reschedule-save-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('tr');
      const ids = row.dataset.equipmentIds ? row.dataset.equipmentIds.split(',').filter(Boolean) : [];
      const dateValue = row.querySelector('.event-reschedule-end-date').value;
      const timeValue = row.querySelector('.event-reschedule-end-time').value;
      homeReschedule(row.dataset.event, ids, dateValue, timeValue);
    });
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

// Bulk version of homeCancelReservation above - one confirm and one
// /api/reserve/cancel call for every item under one event that still has a
// reservation to cancel/end (pending, on-the-shelf Reserved, or checked-out
// with an active hold), rather than clicking Cancel/End on each row
// individually. /api/reserve/cancel already buckets each equipmentId by its
// own current state (drop pending / release to Available / just clear the
// hold), so this works the same for a mixed set as it does one at a time.
async function homeCancelAll(eventName, equipmentIds) {
  if (equipmentIds.length === 0) return;
  setMessage(homeMessage, '', null);
  const confirmed = await askConfirm(
    `Cancel/end the reservation on all ${equipmentIds.length} item${equipmentIds.length === 1 ? '' : 's'} for "${eventName}"?`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/reserve/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: homeViewingId, equipmentIds })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not cancel those reservations.', 'error');
      return;
    }
    setMessage(homeMessage, `Reservations cancelled for "${eventName}".`, 'success');
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

// Bulk version of homeBorrowNow above - one confirm and one /api/borrow/complete
// call for every still-Reserved item under one event, rather than clicking
// "Borrow Now" on each row individually. Only shown (see renderMyItems) once
// there's at least one such item in the group.
async function homeBorrowAll(eventName, equipmentIds) {
  if (equipmentIds.length === 0) return;
  setMessage(homeMessage, '', null);
  const forWhom = homeViewingId === employeeId ? 'you' : `"${homeViewingId}"`;
  const confirmed = await askConfirm(
    `Borrow all ${equipmentIds.length} reserved item${equipmentIds.length === 1 ? '' : 's'} for "${eventName}" now? They'll stay reserved for ${forWhom} until returned or the hold period ends.`
  );
  if (!confirmed) return;

  try {
    // These items were all reserved together under this same event, so they
    // share the same purpose/event - look up the first one for those
    // values, same as the single-item Borrow Now flow above.
    const lookup = await fetch(`/api/equipment/${encodeURIComponent(equipmentIds[0])}`);
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
        equipmentIds,
        miscItems: []
      })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not borrow those items.', 'error');
      return;
    }
    setMessage(
      homeMessage,
      `Borrowed ${equipmentIds.length} item${equipmentIds.length === 1 ? '' : 's'} for "${eventName}".`,
      'success'
    );
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

// Changes the reservation end date/time for every still-Reserved item under
// one event at once - see renderMyItems for when this is offered (only once
// every item in the group is still on the shelf, never picked up) and
// routes/reserve.js's /reschedule for why only the end (not start) is
// adjustable here.
async function homeReschedule(eventName, equipmentIds, dateValue, timeValue) {
  setMessage(homeMessage, '', null);
  if (!dateValue || !timeValue) {
    setMessage(homeMessage, 'Choose a new reservation end date and time.', 'error');
    return;
  }
  // Built here in the browser (see the Reserve tab's own start/end handling)
  // so the picked time means what it looks like in this employee's own
  // local time, then sent as an unambiguous ISO instant.
  const newEnd = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(newEnd.getTime())) {
    setMessage(homeMessage, 'Enter a valid end date/time.', 'error');
    return;
  }
  if (newEnd.getTime() <= Date.now()) {
    setMessage(homeMessage, 'Choose an end date/time in the future.', 'error');
    return;
  }

  const confirmed = await askConfirm(
    `Change the reservation end date/time for "${eventName}" (${equipmentIds.length} item${equipmentIds.length === 1 ? '' : 's'}) to ${formatDateTime(newEnd)}?`
  );
  if (!confirmed) return;

  try {
    const res = await fetch('/api/reserve/reschedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: homeViewingId, equipmentIds, end: newEnd.toISOString() })
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(homeMessage, data.message || 'Could not update the reservation date.', 'error');
      return;
    }
    setMessage(homeMessage, `Reservation date updated for "${eventName}".`, 'success');
    loadMyItems();
  } catch (err) {
    setMessage(homeMessage, 'Could not reach the server.', 'error');
  }
}

// =======================================================
// BORROW / RESERVE TAB
// =======================================================
// One tab, two steps, strictly in order:
//
//   Step 1 - create the event: name it, say what kind of event it is, and
//            choose Borrow (starts now, only a return date is asked for) or
//            Reserve (a start and a return date). Nothing about equipment
//            is shown yet, and "Next" stays disabled until all of it is
//            valid - which is also what unlocks step 2 in the stepper.
//   Step 2 - pick the equipment: the whole inventory grouped by team, then
//            split into per-category cards of checkboxes. Ticking a box
//            pools the item into the cart; Complete tags every pooled item
//            to the employee (via the same /api/borrow and /api/reserve
//            endpoints the two separate tabs used to call).
//
// Both steps read and write one object - requestDraft - so step 2 never has
// to re-derive dates or the acting employee from the form.
const MISC_ITEMS = ['Masking Tape', 'Duct Tape', 'Zip Tie', 'Stickers', 'Printer Cable', 'HDMI Cable', 'DK-2205', 'Scissors'];

// Mirrors TEAM_OPTIONS in constants.js. Items whose team field is blank or
// missing entirely (everything imported before that column existed) are
// grouped under this label rather than dropped from the picker - otherwise
// they'd be impossible to borrow at all until someone tagged them.
const TEAM_OPTIONS = ['Entractiv', 'Timing'];
const UNASSIGNED_TEAM = 'Unassigned';
const UNCATEGORIZED = 'Uncategorized';

// The event built in step 1. Null until step 1 validates, which is exactly
// what gates step 2 - see goToStep() and the stepper click handler.
let requestDraft = null;
let requestStep = 1;
// equipmentId -> { equipmentId, item, comment, team, category } - the cart.
const requestSelection = new Map();
let requestFilter = '';
const expandedTeams = new Set();
const activeCategoryByTeam = new Map(); // team -> category name, or '' for All

const requestStepper = document.getElementById('requestStepper');
const requestStep1 = document.getElementById('requestStep1');
const requestStep2 = document.getElementById('requestStep2');
const eventNameInput = document.getElementById('eventNameInput');
const eventTypeSelect = document.getElementById('eventTypeSelect');
const borrowSchedule = document.getElementById('borrowSchedule');
const reserveSchedule = document.getElementById('reserveSchedule');
const borrowStartLabel = document.getElementById('borrowStartLabel');
const borrowEndDateInput = document.getElementById('borrowEndDateInput');
const borrowEndTimeInput = document.getElementById('borrowEndTimeInput');
const reserveStartDateInput = document.getElementById('reserveStartDateInput');
const reserveStartTimeInput = document.getElementById('reserveStartTimeInput');
const reserveEndDateInput = document.getElementById('reserveEndDateInput');
const reserveEndTimeInput = document.getElementById('reserveEndTimeInput');
const requestOnBehalfInput = document.getElementById('requestOnBehalfInput');
const requestStep1Message = document.getElementById('requestStep1Message');
const requestNextBtn = document.getElementById('requestNextBtn');
const requestSummary = document.getElementById('requestSummary');
const requestFilterInput = document.getElementById('requestFilterInput');
const teamAccordion = document.getElementById('teamAccordion');
const requestCart = document.getElementById('requestCart');
const requestSelectMessage = document.getElementById('requestSelectMessage');
const requestCompleteBtn = document.getElementById('requestCompleteBtn');
const requestStatusMessage = document.getElementById('requestStatusMessage');
const exportBtn = document.getElementById('exportBtn');

// Builds a fixed checklist of miscellaneous items inside `containerEl`: a
// checkbox plus a +/- quantity stepper per row. The checked rows *are* the
// miscellaneous cart - there's no separate "add to cart" step.
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

const requestMisc = createMiscChecklist(document.getElementById('miscChecklist'));

// -------------------------------------------------------
// Step 1: create the event
// -------------------------------------------------------

function currentModeValue() {
  const checked = document.querySelector('input[name="requestMode"]:checked');
  return checked ? checked.value : '';
}

// Borrow's start isn't picked, it's "right now" - so this is only ever a
// read-only display. Refreshed whenever the mode is chosen or the tab is
// opened, plus on a slow timer so it doesn't sit there showing a stale
// minute while someone fills in the rest of the form.
function refreshBorrowStartLabel() {
  if (currentModeValue() !== 'borrow') return;
  borrowStartLabel.textContent = new Date().toLocaleString();
}
setInterval(refreshBorrowStartLabel, 30000);

// Reads the form and either returns the event to build, or the single most
// relevant thing still missing from it. Used both to enable/disable "Next"
// (silently, on every keystroke) and to explain the hold-up when it's
// actually pressed.
function readStep1Draft() {
  if (!employeeId) {
    return { error: "Your account isn't linked to an employee number yet - ask an admin to sort this out." };
  }

  const eventName = eventNameInput.value.trim();
  if (!eventName) return { error: 'Enter an Event Name to continue.' };

  const eventType = eventTypeSelect.value;
  if (!eventType) return { error: 'Select an Event Type to continue.' };

  const mode = currentModeValue();
  if (!mode) return { error: 'Choose whether you want to borrow or reserve.' };

  // Both branches build their Date objects here in the browser, so a picked
  // "09:00" means 9 AM in *this employee's* local time. Only ISO instants
  // are ever sent to the server (see the Complete handler below), which is
  // what keeps the stored time from shifting by the server's own timezone
  // offset.
  let start;
  let end;
  if (mode === 'borrow') {
    if (!borrowEndDateInput.value || !borrowEndTimeInput.value) {
      return { error: 'Select the Return Date / Event End to continue.' };
    }
    start = new Date();
    end = new Date(`${borrowEndDateInput.value}T${borrowEndTimeInput.value}`);
    if (Number.isNaN(end.getTime())) return { error: 'Enter a valid Return Date / Event End.' };
    if (end.getTime() <= Date.now()) return { error: 'The Return Date / Event End must be in the future.' };
  } else {
    if (!reserveStartDateInput.value || !reserveStartTimeInput.value) {
      return { error: 'Select the Start Date / Event Start to continue.' };
    }
    if (!reserveEndDateInput.value || !reserveEndTimeInput.value) {
      return { error: 'Select the Return Date / Event End to continue.' };
    }
    start = new Date(`${reserveStartDateInput.value}T${reserveStartTimeInput.value}`);
    end = new Date(`${reserveEndDateInput.value}T${reserveEndTimeInput.value}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { error: 'Enter a valid start and return date/time.' };
    }
    if (end.getTime() <= start.getTime()) {
      return { error: 'The Return Date / Event End must be after the Start Date / Event Start.' };
    }
    if (end.getTime() <= Date.now()) return { error: 'The Return Date / Event End must be in the future.' };
  }

  // Admin can act on behalf of any employee via the extra ID field that
  // only appears for the Admin account - everyone else always acts as
  // themselves.
  let actingEmployeeId = employeeId;
  if (isAdmin) {
    const onBehalfId = requestOnBehalfInput.value.trim();
    if (!onBehalfId) return { error: 'Enter the Employee ID to borrow/reserve on behalf of.' };
    actingEmployeeId = onBehalfId;
  }

  return { draft: { eventName, eventType, mode, start, end, actingEmployeeId } };
}

function updateStep1State() {
  requestNextBtn.disabled = Boolean(readStep1Draft().error);
}

[eventNameInput, requestOnBehalfInput].forEach((el) => el.addEventListener('input', updateStep1State));
eventTypeSelect.addEventListener('change', updateStep1State);

document.querySelectorAll('input[name="requestMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const mode = currentModeValue();
    borrowSchedule.classList.toggle('hidden', mode !== 'borrow');
    reserveSchedule.classList.toggle('hidden', mode !== 'reserve');
    document.querySelectorAll('.mode-option').forEach((el) => {
      el.classList.toggle('is-chosen', el.querySelector('input').checked);
    });
    refreshBorrowStartLabel();
    updateStep1State();
  });
});

// Picking a date defaults its time to the start/end of that day (12:00 AM /
// 11:59 PM) so a whole event window can be set with just date picks - the
// time fields stay fully editable afterward for anyone who wants a precise
// hour.
[
  [borrowEndDateInput, borrowEndTimeInput, '23:59'],
  [reserveStartDateInput, reserveStartTimeInput, '00:00'],
  [reserveEndDateInput, reserveEndTimeInput, '23:59']
].forEach(([dateInput, timeInput, defaultTime]) => {
  dateInput.addEventListener('change', () => {
    if (dateInput.value && !timeInput.value) timeInput.value = defaultTime;
    updateStep1State();
  });
  timeInput.addEventListener('change', updateStep1State);
});

function goToStep(step) {
  requestStep = step;
  requestStep1.classList.toggle('active', step === 1);
  requestStep2.classList.toggle('active', step === 2);
  requestStepper.querySelectorAll('.stepper-step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-current', n === step);
    el.classList.toggle('is-done', n < step);
    // Step 2 can't be clicked into until step 1 has actually produced an
    // event - that's the whole "no skipping ahead" rule.
    el.classList.toggle('is-locked', n === 2 && !requestDraft);
  });
}

requestStepper.querySelectorAll('.stepper-step').forEach((el) => {
  el.addEventListener('click', () => {
    const n = Number(el.dataset.step);
    if (n === 2 && !requestDraft) {
      setMessage(requestStep1Message, 'Fill in the event details and press Next before selecting equipment.', 'error');
      return;
    }
    goToStep(n);
  });
});

requestNextBtn.addEventListener('click', async () => {
  const { draft, error } = readStep1Draft();
  if (error) {
    setMessage(requestStep1Message, error, 'error');
    return;
  }
  setMessage(requestStep1Message, '', null);

  // Switching between Borrow and Reserve changes which items are pickable
  // at all (a Reserve can't take an item that already has an upcoming hold,
  // a Borrow can), so coming back through here with a different mode
  // re-checks everything already in the cart - see refreshRequestPicker.
  requestDraft = draft;
  renderRequestSummary();
  goToStep(2);
  // Statuses may have moved since the page loaded, so step 2 always opens
  // against a freshly fetched inventory (which re-renders the picker on its
  // own - see loadInventory).
  await loadInventory();
});

document.getElementById('refreshRequestBtn').addEventListener('click', () => loadInventory());

// -------------------------------------------------------
// Step 2: pick the equipment
// -------------------------------------------------------

function renderRequestSummary() {
  if (!requestDraft) {
    requestSummary.innerHTML = '';
    return;
  }
  const { eventName, eventType, mode, start, end } = requestDraft;
  const startText = mode === 'borrow' ? `Now (${formatDateTime(start)})` : formatDateTime(start);
  requestSummary.innerHTML = `
    <div class="event-summary-main">
      <span class="event-summary-mode mode-${mode}">${mode === 'borrow' ? 'Borrow' : 'Reserve'}</span>
      <strong class="event-summary-name">${escapeHtml(eventName)}</strong>
      <span class="event-summary-type">${escapeHtml(eventType)}</span>
    </div>
    <div class="event-summary-dates">${escapeHtml(startText)} &rarr; ${escapeHtml(formatDateTime(end))}</div>
    <button id="requestEditBtn" type="button" class="secondary-btn">Edit Event Details</button>`;
  requestSummary.querySelector('#requestEditBtn').addEventListener('click', () => goToStep(1));
}

function teamOf(it) {
  return (it.team || '').trim() || UNASSIGNED_TEAM;
}

function categoryOf(it) {
  return (it.category || '').trim() || UNCATEGORIZED;
}

// Whether this item can be pooled into the cart for the request being
// built, plus whatever hold is already on it (so a blocked row can explain
// itself with the event name and dates rather than just "unavailable").
// Borrow and Reserve deliberately differ here, matching what
// routes/borrow.js and routes/reserve.js will actually accept:
//   - Borrowed by anyone: neither.
//   - Actively reserved by the acting employee: borrow only (a reserving
//     employee can check their own held items in and out freely within the
//     window; a second reservation on top of it isn't a thing).
//   - Actively reserved by someone else: neither.
//   - Free right now but carrying an upcoming (not-yet-started) hold from
//     anyone: borrow yes (the item genuinely is free), reserve no (only one
//     upcoming hold is stored per item).
//   - Plain Available: both.
function requestAvailability(it) {
  const statusLabel = normalizeStatusLabel(it.status);
  const mode = requestDraft ? requestDraft.mode : 'borrow';
  const actingId = requestDraft ? requestDraft.actingEmployeeId : employeeId;
  const holderName = it.employeeName ? `${it.employeeName} (${it.employeeId})` : it.employeeId || null;

  if (statusLabel === 'Unavailable') {
    return {
      label: 'Borrowed',
      cssClass: 'pick-unavailable',
      selectable: false,
      hold: { who: holderName, event: it.event, from: null, until: it.borrowUntil }
    };
  }

  const reservedActive = Boolean(it.reservedUntil) && new Date(it.reservedUntil).getTime() > Date.now();
  if (statusLabel === 'Reserved' && reservedActive) {
    const hold = { who: holderName, event: it.event, from: null, until: it.reservedUntil };
    if (it.employeeId === actingId && mode === 'borrow') {
      return { label: 'Reserved (yours)', cssClass: 'pick-mine', selectable: true, hold };
    }
    return { label: 'Reserved', cssClass: 'pick-reserved', selectable: false, hold };
  }

  const pending = it.pendingReservation;
  const pendingUnexpired = Boolean(pending) && new Date(pending.end).getTime() > Date.now();
  if (pendingUnexpired) {
    const hold = { who: pending.employeeId, event: pending.event, from: pending.start, until: pending.end };
    return { label: 'Reserved (upcoming)', cssClass: 'pick-upcoming', selectable: mode === 'borrow', hold };
  }

  return { label: 'Available', cssClass: 'pick-available', selectable: true, hold: null };
}

// The "event name and date" line shown on any row that's already spoken
// for, whether that hold blocks this particular request or not.
function holdNoteHtml(hold) {
  if (!hold) return '';
  const bits = [];
  if (hold.event) bits.push(`<span class="pick-hold-event">${escapeHtml(hold.event)}</span>`);
  if (hold.from && hold.until) {
    bits.push(`${escapeHtml(formatDateTime(hold.from))} &rarr; ${escapeHtml(formatDateTime(hold.until))}`);
  } else if (hold.until) {
    bits.push(`until ${escapeHtml(formatDateTime(hold.until))}`);
  }
  if (hold.who) bits.push(escapeHtml(hold.who));
  if (bits.length === 0) return '';
  return `<span class="pick-hold">${bits.join(' &middot; ')}</span>`;
}

function matchesRequestFilter(it) {
  return !requestFilter || equipmentLabelMatches(it, requestFilter);
}

// Fixed teams first in their declared order, then any unexpected value
// alphabetically, with Unassigned always last since it isn't a real team.
function requestTeamGroups() {
  const byTeam = new Map();
  inventoryItems.forEach((it) => {
    const team = teamOf(it);
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(it);
  });
  const extras = [...byTeam.keys()]
    .filter((t) => !TEAM_OPTIONS.includes(t) && t !== UNASSIGNED_TEAM)
    .sort((a, b) => a.localeCompare(b));
  const ordered = [
    ...TEAM_OPTIONS.filter((t) => byTeam.has(t)),
    ...extras,
    ...(byTeam.has(UNASSIGNED_TEAM) ? [UNASSIGNED_TEAM] : [])
  ];
  return ordered.map((team) => [team, byTeam.get(team)]);
}

// Categories present in `items`, alphabetically, with Uncategorized last.
function categoriesOf(items) {
  const names = [...new Set(items.map(categoryOf))];
  return [
    ...names.filter((c) => c !== UNCATEGORIZED).sort((a, b) => a.localeCompare(b)),
    ...(names.includes(UNCATEGORIZED) ? [UNCATEGORIZED] : [])
  ];
}

function teamMetaText(total, available, selected) {
  const parts = [`${total} item${total === 1 ? '' : 's'}`, `${available} selectable`];
  if (selected) parts.push(`${selected} in cart`);
  return parts.join(' · ');
}

function pickRowHtml(it) {
  const avail = requestAvailability(it);
  const selected = requestSelection.has(it.equipmentId);
  const classes = ['pick-row', avail.cssClass];
  if (selected) classes.push('is-selected');
  if (!avail.selectable) classes.push('is-blocked');
  if (avail.hold) classes.push('is-held');

  const note = [it.comment, it.location, it.ports].filter(Boolean).join(' · ');

  return `
    <label class="${classes.join(' ')}">
      <input
        type="checkbox"
        class="pick-check"
        data-equipment-id="${escapeHtml(it.equipmentId)}"
        ${selected ? 'checked' : ''}
        ${avail.selectable ? '' : 'disabled'}
      >
      <span class="pick-body">
        <span class="pick-name">${escapeHtml(it.item)}</span>
        <span class="pick-id">${escapeHtml(it.equipmentId)}</span>
        ${note ? `<span class="pick-note">${escapeHtml(note)}</span>` : ''}
      </span>
      <span class="pick-state">
        <span class="pick-badge ${avail.cssClass}">${escapeHtml(avail.label)}</span>
        ${holdNoteHtml(avail.hold)}
      </span>
    </label>`;
}

function renderTeamAccordion() {
  if (!requestDraft) return;

  const groups = requestTeamGroups();
  if (groups.length === 0) {
    teamAccordion.innerHTML = '<p class="empty-note">No equipment in the database yet.</p>';
    return;
  }

  const html = groups
    .map(([team, items]) => {
      const visible = items.filter(matchesRequestFilter);
      // A filter that matches nothing in this team hides the whole group -
      // with no filter, every team stays listed so the counts are honest.
      if (requestFilter && visible.length === 0) return '';

      const selectedCount = items.filter((i) => requestSelection.has(i.equipmentId)).length;
      const availableCount = items.filter((i) => requestAvailability(i).selectable).length;
      // A filter is a search: auto-open whatever it matched rather than
      // making people expand each team to find out where the hit was.
      const expanded = expandedTeams.has(team) || Boolean(requestFilter);
      const categories = categoriesOf(visible);
      const activeCategory = activeCategoryByTeam.get(team) || '';
      // A category tab can stop existing once the filter narrows things
      // down - fall back to All rather than rendering an empty body.
      const effectiveCategory = categories.includes(activeCategory) ? activeCategory : '';

      const categoryTabs = `
        <div class="category-tabs">
          <button type="button" class="cat-tab${effectiveCategory === '' ? ' active' : ''}" data-team="${escapeHtml(team)}" data-category="">
            All<span class="cat-count">${visible.length}</span>
          </button>
          ${categories
            .map(
              (cat) => `
            <button type="button" class="cat-tab${effectiveCategory === cat ? ' active' : ''}" data-team="${escapeHtml(team)}" data-category="${escapeHtml(cat)}">
              ${escapeHtml(cat)}<span class="cat-count">${visible.filter((i) => categoryOf(i) === cat).length}</span>
            </button>`
            )
            .join('')}
        </div>`;

      const cards = categories
        .filter((cat) => effectiveCategory === '' || cat === effectiveCategory)
        .map((cat) => {
          const catItems = visible
            .filter((i) => categoryOf(i) === cat)
            .sort((a, b) => a.item.localeCompare(b.item) || a.equipmentId.localeCompare(b.equipmentId));
          const catSelected = catItems.filter((i) => requestSelection.has(i.equipmentId)).length;
          return `
          <div class="pick-card" data-category="${escapeHtml(cat)}">
            <div class="pick-card-head">
              <h4>${escapeHtml(cat)}</h4>
              <span class="pick-card-meta">${catItems.length} item${catItems.length === 1 ? '' : 's'}${
                catSelected ? ` · ${catSelected} selected` : ''
              }</span>
            </div>
            <div class="pick-card-body">${catItems.map(pickRowHtml).join('')}</div>
          </div>`;
        })
        .join('');

      return `
      <div class="team-group${expanded ? ' is-open' : ''}" data-team="${escapeHtml(team)}">
        <button type="button" class="team-toggle" data-team="${escapeHtml(team)}" aria-expanded="${expanded}">
          <span class="team-caret" aria-hidden="true"></span>
          <span class="team-name">${escapeHtml(team)}</span>
          <span class="team-meta" data-team-meta="${escapeHtml(team)}">${teamMetaText(items.length, availableCount, selectedCount)}</span>
        </button>
        <div class="team-body${expanded ? '' : ' hidden'}">
          ${
            visible.length === 0
              ? '<p class="empty-note">No equipment in this team.</p>'
              : `${categoryTabs}<div class="pick-cards">${cards}</div>`
          }
        </div>
      </div>`;
    })
    .join('');

  teamAccordion.innerHTML = html || '<p class="empty-note">No equipment matches that filter.</p>';

  teamAccordion.querySelectorAll('.team-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const team = btn.dataset.team;
      if (expandedTeams.has(team)) expandedTeams.delete(team);
      else expandedTeams.add(team);
      // A filter force-opens every matching group, so collapsing one only
      // means anything once the filter is cleared - drop it here so the
      // click does something visible either way.
      if (requestFilter) {
        requestFilter = '';
        requestFilterInput.value = '';
      }
      renderTeamAccordion();
    });
  });

  teamAccordion.querySelectorAll('.cat-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCategoryByTeam.set(btn.dataset.team, btn.dataset.category);
      renderTeamAccordion();
    });
  });

  teamAccordion.querySelectorAll('.pick-check').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      toggleSelection(checkbox.dataset.equipmentId, checkbox.checked);
    });
  });
}

// Ticking a box only needs the row's own look, the team/category counters
// and the cart to change - rebuilding the whole accordion would lose scroll
// position and the focus ring on the checkbox that was just clicked.
function syncPickerCounters() {
  requestTeamGroups().forEach(([team, items]) => {
    const metaEl = teamAccordion.querySelector(`[data-team-meta="${CSS.escape(team)}"]`);
    if (!metaEl) return;
    const selectedCount = items.filter((i) => requestSelection.has(i.equipmentId)).length;
    const availableCount = items.filter((i) => requestAvailability(i).selectable).length;
    metaEl.textContent = teamMetaText(items.length, availableCount, selectedCount);
  });

  teamAccordion.querySelectorAll('.pick-check').forEach((checkbox) => {
    const row = checkbox.closest('.pick-row');
    if (row) row.classList.toggle('is-selected', requestSelection.has(checkbox.dataset.equipmentId));
  });

  teamAccordion.querySelectorAll('.pick-card').forEach((card) => {
    const ids = [...card.querySelectorAll('.pick-check')].map((c) => c.dataset.equipmentId);
    const selected = ids.filter((id) => requestSelection.has(id)).length;
    const metaEl = card.querySelector('.pick-card-meta');
    if (metaEl) {
      metaEl.textContent = `${ids.length} item${ids.length === 1 ? '' : 's'}${selected ? ` · ${selected} selected` : ''}`;
    }
  });
}

function toggleSelection(equipmentId, checked) {
  const it = inventoryItems.find((i) => i.equipmentId === equipmentId);
  if (!it) return;

  if (checked) {
    if (!requestAvailability(it).selectable) return;
    requestSelection.set(equipmentId, {
      equipmentId: it.equipmentId,
      item: it.item,
      comment: it.comment,
      team: teamOf(it),
      category: categoryOf(it)
    });
  } else {
    requestSelection.delete(equipmentId);
  }

  renderRequestCart();
  syncPickerCounters();
}

function renderRequestCart() {
  const picked = [...requestSelection.values()];
  if (picked.length === 0) {
    requestCart.innerHTML =
      '<p class="empty-note">No equipment selected yet. Tick the items you need above and they\'ll pool here.</p>';
    return;
  }

  requestCart.innerHTML = `
    <div class="request-cart-head">
      <strong>${picked.length} item${picked.length === 1 ? '' : 's'} selected</strong>
      <button type="button" class="remove-btn" id="requestClearCartBtn">Clear All</button>
    </div>
    <ul class="request-cart-list">
      ${picked
        .map(
          (c) => `
        <li>
          <span class="tag-chip">${escapeHtml(c.equipmentId)}</span>
          <span class="request-cart-name">${escapeHtml(c.item)}</span>
          <span class="request-cart-meta">${escapeHtml(c.team)} &middot; ${escapeHtml(c.category)}</span>
          <button type="button" class="remove-btn" data-equipment-id="${escapeHtml(c.equipmentId)}">Remove</button>
        </li>`
        )
        .join('')}
    </ul>`;

  requestCart.querySelector('#requestClearCartBtn').addEventListener('click', () => {
    requestSelection.clear();
    // Unticking has to happen in the DOM too - the accordion isn't rebuilt
    // on a cart change (see syncPickerCounters).
    teamAccordion.querySelectorAll('.pick-check:checked').forEach((c) => {
      c.checked = false;
    });
    renderRequestCart();
    syncPickerCounters();
  });

  requestCart.querySelectorAll('.remove-btn[data-equipment-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.equipmentId;
      requestSelection.delete(id);
      const checkbox = teamAccordion.querySelector(`.pick-check[data-equipment-id="${CSS.escape(id)}"]`);
      if (checkbox) checkbox.checked = false;
      renderRequestCart();
      syncPickerCounters();
    });
  });
}

// Anything in the cart that a fresh inventory read (or a switch between
// Borrow and Reserve) has made un-pickable is dropped here, rather than
// waiting for the server to reject the whole request at Complete.
function pruneInvalidSelection() {
  const dropped = [];
  [...requestSelection.keys()].forEach((id) => {
    const it = inventoryItems.find((i) => i.equipmentId === id);
    if (!it || !requestAvailability(it).selectable) {
      dropped.push(requestSelection.get(id).item);
      requestSelection.delete(id);
    }
  });
  if (dropped.length > 0) {
    setMessage(
      requestSelectMessage,
      `Removed from your cart - no longer available for this request: ${dropped.map((n) => `"${n}"`).join(', ')}.`,
      'error'
    );
  }
}

// Called by loadInventory() so the picker always reflects the same dataset
// the rest of the page is working from.
function refreshRequestPicker() {
  if (!requestDraft) return;
  pruneInvalidSelection();
  renderTeamAccordion();
  renderRequestCart();
}

requestFilterInput.addEventListener('input', () => {
  requestFilter = requestFilterInput.value.trim();
  renderTeamAccordion();
});

// A barcode scan is just a very precise filter: the scanned ID goes into the
// filter box (so the item is the only thing left on screen) and gets ticked,
// if it's pickable for this request at all.
function requestPickByScan(scannedValue) {
  const id = (scannedValue || '').trim();
  setMessage(requestSelectMessage, '', null);
  if (!id) return;

  requestFilter = id;
  requestFilterInput.value = id;

  const it = inventoryItems.find((i) => i.equipmentId.toLowerCase() === id.toLowerCase());
  if (!it) {
    renderTeamAccordion();
    setMessage(requestSelectMessage, `Equipment ID "${id}" was not found.`, 'error');
    return;
  }

  expandedTeams.add(teamOf(it));
  activeCategoryByTeam.set(teamOf(it), '');

  if (requestSelection.has(it.equipmentId)) {
    renderTeamAccordion();
    setMessage(requestSelectMessage, `"${it.item}"${idSuffix(it.equipmentId)} is already in your cart.`, 'success');
    return;
  }

  const avail = requestAvailability(it);
  if (!avail.selectable) {
    renderTeamAccordion();
    const holder = avail.hold && avail.hold.who ? ` by ${avail.hold.who}` : '';
    const forEvent = avail.hold && avail.hold.event ? ` for "${avail.hold.event}"` : '';
    setMessage(
      requestSelectMessage,
      `"${it.item}"${idSuffix(it.equipmentId)} is ${avail.label.toLowerCase()}${holder}${forEvent}. Please pick another item.`,
      'error'
    );
    return;
  }

  toggleSelection(it.equipmentId, true);
  renderTeamAccordion();
  setMessage(requestSelectMessage, `Added "${it.item}"${idSuffix(it.equipmentId)} to your cart.`, 'success');
}

requestCompleteBtn.addEventListener('click', async () => {
  setMessage(requestStatusMessage, '', null);

  if (!requestDraft) {
    goToStep(1);
    setMessage(requestStep1Message, 'Fill in the event details first.', 'error');
    return;
  }

  const miscItems = requestMisc.getCheckedItems();
  const picked = [...requestSelection.values()];
  const equipmentIds = picked.map((c) => c.equipmentId);

  if (equipmentIds.length === 0 && miscItems.length === 0) {
    setMessage(requestStatusMessage, 'Select at least one item before completing.', 'error');
    return;
  }

  const isBorrow = requestDraft.mode === 'borrow';
  if (requestDraft.end.getTime() <= Date.now()) {
    setMessage(
      requestStatusMessage,
      'The Return Date / Event End has already passed. Go back to Event Details and pick a new one.',
      'error'
    );
    return;
  }

  const itemCount = equipmentIds.length + miscItems.length;
  const confirmed = await askConfirm(
    isBorrow
      ? `Borrow ${itemCount} item${itemCount === 1 ? '' : 's'} for "${requestDraft.eventName}"? The selected equipment will be marked unavailable and tagged to you until ${formatDateTime(requestDraft.end)}.`
      : `Reserve ${itemCount} item${itemCount === 1 ? '' : 's'} for "${requestDraft.eventName}"? If the start is in the future, the equipment stays available to everyone until then.`
  );
  if (!confirmed) return;

  // Borrow starts "now", so its start instant is taken at this moment
  // rather than whenever step 1 happened to be filled in.
  const body = isBorrow
    ? {
        employeeId: requestDraft.actingEmployeeId,
        purpose: requestDraft.eventType,
        event: requestDraft.eventName,
        equipmentIds,
        miscItems,
        borrowUntil: requestDraft.end.toISOString()
      }
    : {
        employeeId: requestDraft.actingEmployeeId,
        purpose: requestDraft.eventType,
        event: requestDraft.eventName,
        start: requestDraft.start.toISOString(),
        end: requestDraft.end.toISOString(),
        equipmentIds,
        miscItems
      };

  try {
    const res = await fetch(isBorrow ? '/api/borrow/complete' : '/api/reserve/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.conflicts) {
        const lines = data.conflicts.map((c) => {
          if (c.reason === 'pending_reservation') {
            return `${conflictLabel(picked, c.equipmentId)} already has an upcoming reservation from ${c.borrowerId}.`;
          }
          if (c.reason === 'unavailable') {
            return `${conflictLabel(picked, c.equipmentId)} is no longer available.`;
          }
          return `${conflictLabel(picked, c.equipmentId)} was not found.`;
        });
        setMessage(requestStatusMessage, `${data.message} ${lines.join(' ')}`, 'error');
        // Whatever the server rejected drops out of the cart on its own once
        // the refreshed statuses come back (see pruneInvalidSelection).
        await loadInventory();
      } else {
        setMessage(requestStatusMessage, data.message || 'Could not complete the request.', 'error');
      }
      return;
    }

    // Reload straight back to My Items rather than resetting the two steps
    // in place - My Items is the tab already marked active in the static
    // HTML, so a fresh page load lands there on its own. (This does mean
    // the "Export to Word" button below - only ever enabled right after a
    // borrow completes in the current page - never gets a chance to turn
    // on; that's an accepted tradeoff of reloading here.)
    window.location.reload();
  } catch (err) {
    setMessage(requestStatusMessage, 'Could not reach the server.', 'error');
  }
});

exportBtn.addEventListener('click', async () => {
  setMessage(requestStatusMessage, 'Generating document…', null);
  try {
    const res = await fetch(`/api/export/${encodeURIComponent(employeeId)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(requestStatusMessage, data.message || 'Could not generate the document.', 'error');
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
    setMessage(requestStatusMessage, 'Document downloaded.', 'success');
  } catch (err) {
    setMessage(requestStatusMessage, 'Could not reach the server.', 'error');
  }
});

updateStep1State();
renderRequestCart();

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

    // Reload straight back to My Items rather than resetting the cart in
    // place - My Items is the tab already marked active in the static HTML,
    // so a fresh page load lands there on its own.
    window.location.reload();
  } catch (err) {
    setMessage(returnStatusMessage, 'Could not reach the server.', 'error');
  }
});

// Shared by step 2's equipment filter (Borrow/Reserve) - matches a typed
// keyword against an item's ID, name or category.
function equipmentLabelMatches(it, query) {
  return `${it.equipmentId} ${it.item} ${it.category || ''}`.toLowerCase().includes(query.toLowerCase());
}

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

function teamMatches(value, filterValue) {
  if (!filterValue) return true;
  const team = String(value || '').trim().toLowerCase();
  if (filterValue === '__unassigned__') return team === '';
  return team === filterValue;
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

// Formats a Date into the value strings <input type="date">/<input
// type="time"> expect, in the browser's own local time (not UTC) - used to
// pre-fill the "Change Reservation Date" fields with the reservation's
// current end.
function toLocalDateInputValue(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toLocalTimeInputValue(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadInventory() {
  inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="10">Loading inventory…</td></tr>';
  setMessage(inventoryMessage, '', null);
  try {
    const res = await fetch('/api/equipment');
    const items = await res.json();

    if (!res.ok) {
      inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="10">Could not load inventory.</td></tr>';
      return;
    }

    inventoryItems = items;
    applyInventoryFilters();
    // Step 2 of the Borrow/Reserve tab is built off this exact dataset, so
    // every refresh (here, the tab switch above, or its own Refresh button)
    // keeps its availability badges and cart honest.
    refreshRequestPicker();
  } catch (err) {
    inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="10">Could not reach the server.</td></tr>';
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
      // The Team filter is a fixed dropdown rather than free text, so it
      // needs an exact match - plus its own sentinel for the blank/missing
      // values that the Borrow/Reserve picker groups under "Unassigned".
      teamMatches(i.team, inventoryFilters.team) &&
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
    inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="10">No equipment in the database.</td></tr>';
    return;
  }
  if (items.length === 0) {
    inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="10">No equipment matches the current filters.</td></tr>';
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
      // Equipment ID is the lead column here - it's the item's own barcode
      // value, visible to every user (not just Admin).
      const equipmentIdCell = `<span class="tag-chip">${escapeHtml(i.equipmentId) || '-'}</span>`;
      const itemCell = isAdmin ? adminField(i.equipmentId, 'item', i.item) : escapeHtml(i.item);
      // Team decides which group an item shows under in step 2 of the
      // Borrow/Reserve tab, so Admin gets a fixed dropdown here rather than
      // a text box - a typo would strand the item in a group of its own.
      // Blank is a real choice: it means "Unassigned" in the picker.
      const teamCell = isAdmin
        ? `<select class="comment-input admin-field admin-select" data-equipment-id="${escapeHtml(i.equipmentId)}" data-field="team">
            <option value="" ${!i.team ? 'selected' : ''}>Unassigned</option>
            ${TEAM_OPTIONS.map(
              (opt) => `<option value="${escapeHtml(opt)}" ${opt === i.team ? 'selected' : ''}>${escapeHtml(opt)}</option>`
            ).join('')}
          </select>`
        : escapeHtml(i.team) || '-';
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
        <td>${equipmentIdCell}</td>
        <td>${itemCell}</td>
        <td>${teamCell}</td>
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
// BARCODE SCANNER (Borrow/Reserve & Return)
// =======================================================
// Uses the html5-qrcode library (loaded via <script> in dashboard.html) to
// open the camera, draw a scanning-box outline over the video feed, and
// decode common barcode/QR formats. A successful scan fills whichever
// input triggered the scan and runs that tab's normal add flow, so scanned
// equipment goes through the exact same availability check as an item
// ticked by hand. On the Borrow/Reserve tab the "input" is step 2's filter
// box, so a scan also narrows the picker down to the item it just ticked.
const scanRequestBtn = document.getElementById('scanRequestBtn');
const scanReturnBtn = document.getElementById('scanReturnBtn');
const scannerModal = document.getElementById('scannerModal');
const scannerCloseBtn = document.getElementById('scannerCloseBtn');
const scannerError = document.getElementById('scannerError');
let activeScanner = null;
let scanTarget = null; // { input, handler } - which tab requested the scan

scanRequestBtn.addEventListener('click', () =>
  startScanner(requestFilterInput, () => requestPickByScan(requestFilterInput.value))
);
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
