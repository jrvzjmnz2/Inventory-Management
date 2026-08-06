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

// The Equipment ID is never shown in the mobile app - everyone here works
// off item names, Location, and barcode scans instead. These resolve a raw
// ID back to something displayable whenever a message would otherwise have
// shown it.
function idLabel(equipmentId) {
  const match = inventoryItems.find((it) => it.equipmentId === equipmentId);
  return match ? `"${match.item}"` : 'That item';
}

function conflictLabel(cart, equipmentId) {
  const found = cart.find((c) => c.equipmentId === equipmentId);
  return found ? `"${found.item}"` : 'That item';
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
document.getElementById('refreshHomeBtn').addEventListener('click', loadMyItems);

async function loadMyItems() {
  homeBody.innerHTML = '<tr class="empty-row"><td colspan="5">Loading your items…</td></tr>';
  setMessage(homeMessage, '', null);
  try {
    const res = await fetch(apiUrl('/api/equipment'));
    const items = await res.json();
    if (!res.ok) {
      homeBody.innerHTML = '<tr class="empty-row"><td colspan="5">Could not load your items.</td></tr>';
      return;
    }

    const mine = items.filter((i) => {
      if (i.employeeId !== employeeId) return false;
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
          i.pendingReservation.employeeId === employeeId &&
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
// up front (see routes/borrow.js) - but if it isn't returned in time, that
// other person's reservation silently lapses and never activates (see
// autoExpireReservation in routes/equipment.js). There's no email/push layer
// in this app, so the only way to "notify" the borrower is this on-screen
// warning in My Items - shown once the pending reservation's start is within
// a day out, so there's still time to return it beforehand.
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
      <td><span class="tag-chip">${escapeHtml(i.equipmentId)}</span></td>
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
    // before it's actually returned. No one-click "just return it" button.
    actionsHtml = `
      <div class="home-return-scan-group" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}">
        <input type="text" class="comment-input home-return-scan-input" placeholder="Scan barcode to return">
        <button class="scan-btn home-scan-camera-btn" type="button" aria-label="Scan with camera to return" title="Scan with camera to return">${SCAN_ICON_SVG}</button>
      </div>
      ${reservationActive ? `<button class="remove-btn home-end-btn" data-equipment-id="${escapeHtml(i.equipmentId)}" data-item="${escapeHtml(i.item)}" type="button">End Reservation</button>` : ''}`;
  }

  const warning = statusLabel === 'Unavailable' ? pendingReturnWarning(i) : null;

  return `
  <tr>
    <td><span class="tag-chip">${escapeHtml(i.equipmentId)}</span></td>
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
    homeBody.innerHTML = '<tr class="empty-row"><td colspan="5">You don\'t have any equipment reserved or checked out right now.</td></tr>';
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
  homeBody.querySelectorAll('.home-return-scan-group').forEach((group) => {
    const equipmentId = group.dataset.equipmentId;
    const itemLabel = group.dataset.item;
    const input = group.querySelector('.home-return-scan-input');
    const camBtn = group.querySelector('.home-scan-camera-btn');
    // This field only accepts a physical barcode scanner's input, never
    // manual keyboard typing - see bindScanOnlyInput above.
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
// scoped to whichever event group the button was clicked under.
async function createEventEquipmentList(eventName) {
  setMessage(homeMessage, 'Generating document…', null);
  try {
    const res = await fetch(
      apiUrl(`/api/export/event/${encodeURIComponent(employeeId)}?event=${encodeURIComponent(eventName)}`)
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
    a.download = `Equipment_List_${employeeId}_${eventName}.docx`;
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
// requires.
async function homeBorrowNow(equipmentId, itemLabel) {
  setMessage(homeMessage, '', null);
  const label = itemLabel || 'this item';
  try {
    const lookup = await fetch(apiUrl(`/api/equipment/${encodeURIComponent(equipmentId)}`));
    const eq = await lookup.json();
    if (!lookup.ok) {
      setMessage(homeMessage, eq.message || 'Could not look up that item.', 'error');
      return;
    }

    const res = await fetch(apiUrl('/api/borrow/complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
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
// sent to the server. That match is itself the confirmation.
async function homeReturnByScan(equipmentId, scannedValue, inputEl, itemLabel) {
  const scanned = String(scannedValue || '').trim();
  if (!scanned) return;

  const label = itemLabel || 'this item';
  if (scanned.toUpperCase() !== equipmentId.toUpperCase()) {
    setMessage(homeMessage, `Scanned code "${scanned}" doesn't match "${label}" - scan that item's own barcode.`, 'error');
    if (inputEl) inputEl.value = '';
    return;
  }

  setMessage(homeMessage, '', null);
  try {
    const res = await fetch(apiUrl('/api/return/complete'), {
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

async function homeCancelReservation(equipmentId, itemLabel) {
  setMessage(homeMessage, '', null);
  const label = itemLabel || 'this item';
  try {
    const res = await fetch(apiUrl('/api/reserve/cancel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, equipmentIds: [equipmentId] })
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

// Bulk version of homeCancelReservation above - one /api/reserve/cancel call
// for every item under one event that still has a reservation to cancel/end
// (pending, on-the-shelf Reserved, or checked-out with an active hold),
// rather than tapping Cancel/End on each row individually. /api/reserve/cancel
// already buckets each equipmentId by its own current state (drop pending /
// release to Available / just clear the hold), so this works the same for a
// mixed set as it does one at a time.
async function homeCancelAll(eventName, equipmentIds) {
  if (equipmentIds.length === 0) return;
  setMessage(homeMessage, '', null);
  try {
    const res = await fetch(apiUrl('/api/reserve/cancel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, equipmentIds })
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

// Bulk version of homeBorrowNow above - one /api/borrow/complete call for
// every still-Reserved item under one event, rather than tapping "Borrow
// Now" on each row individually. Only shown (see renderMyItems) once
// there's at least one such item in the group.
async function homeBorrowAll(eventName, equipmentIds) {
  if (equipmentIds.length === 0) return;
  setMessage(homeMessage, '', null);
  try {
    // These items were all reserved together under this same event, so they
    // share the same purpose/event - look up the first one for those
    // values, same as the single-item Borrow Now flow above.
    const lookup = await fetch(apiUrl(`/api/equipment/${encodeURIComponent(equipmentIds[0])}`));
    const eq = await lookup.json();
    if (!lookup.ok) {
      setMessage(homeMessage, eq.message || 'Could not look up that item.', 'error');
      return;
    }

    const res = await fetch(apiUrl('/api/borrow/complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
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

  try {
    const res = await fetch(apiUrl('/api/reserve/reschedule'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, equipmentIds, end: newEnd.toISOString() })
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
// so an item that's Reserved by this employee is addable here too, not
// just plain Available items.
function isMyActiveReservation(data) {
  return (
    normalizeStatusLabel(data.status) === 'Reserved' &&
    data.employeeId === employeeId &&
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
    const res = await fetch(apiUrl(`/api/equipment/${encodeURIComponent(id)}`));
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
        `"${data.item}" is currently borrowed by ${borrower}. Please select another item.`,
        'error'
      );
      return;
    }

    borrowCart.push({ equipmentId: data.equipmentId, item: data.item, comment: data.comment });
    // Only clear the box for manual typing/camera-scan (no overrideId) - a
    // suggestion-dropdown pick passes its equipmentId as overrideId and
    // deliberately leaves the typed search text alone so more items can be
    // picked from the same results without retyping.
    if (typeof overrideId !== 'string') borrowInput.value = '';
    setMessage(borrowMessage, `Added "${data.item}" to cart.`, 'success');
    renderBorrowCart();
  } catch (err) {
    setMessage(borrowMessage, 'Could not reach the server.', 'error');
  }
}

function renderBorrowCart() {
  if (borrowCart.length === 0) {
    borrowCartBody.innerHTML = '<tr class="empty-row"><td colspan="3">No equipment added yet.</td></tr>';
    return;
  }
  borrowCartBody.innerHTML = borrowCart
    .map(
      (c, idx) => `
      <tr>
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

  try {
    const res = await fetch(apiUrl('/api/borrow/complete'), {
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
    const res = await fetch(apiUrl(`/api/export/${encodeURIComponent(employeeId)}`));
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
    const res = await fetch(apiUrl(`/api/equipment/${encodeURIComponent(id)}`));
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
      setMessage(returnMessage, `"${data.item}" ${reason}.`, 'error');
      return;
    }

    returnCart.push({
      equipmentId: data.equipmentId,
      item: data.item,
      borrowerId: data.employeeName ? `${data.employeeName} (${data.employeeId})` : data.employeeId
    });
    returnInput.value = '';
    setMessage(returnMessage, `Added "${data.item}" to return cart.`, 'success');
    renderReturnCart();
  } catch (err) {
    setMessage(returnMessage, 'Could not reach the server.', 'error');
  }
}

function renderReturnCart() {
  if (returnCart.length === 0) {
    returnCartBody.innerHTML = '<tr class="empty-row"><td colspan="3">No equipment added yet.</td></tr>';
    return;
  }
  returnCartBody.innerHTML = returnCart
    .map(
      (c, idx) => `
      <tr>
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
    const res = await fetch(apiUrl('/api/return/complete'), {
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
    const res = await fetch(apiUrl(`/api/equipment/${encodeURIComponent(id)}`));
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
      setMessage(reserveMessage, `"${data.item}" ${reason}. Please select another item.`, 'error');
      return;
    }
    if (pendingActive) {
      setMessage(
        reserveMessage,
        `"${data.item}" already has an upcoming reservation${
          data.pendingReservation.event ? ` for "${data.pendingReservation.event}"` : ''
        } starting ${formatDateTime(data.pendingReservation.start)}. Please select another item.`,
        'error'
      );
      return;
    }

    reserveCart.push({ equipmentId: data.equipmentId, item: data.item, comment: data.comment });
    // Only clear the box for manual typing/camera-scan (no overrideId) - a
    // suggestion-dropdown pick passes its equipmentId as overrideId and
    // deliberately leaves the typed search text alone so more items can be
    // picked from the same results without retyping.
    if (typeof overrideId !== 'string') reserveInput.value = '';
    setMessage(reserveMessage, `Added "${data.item}" to cart.`, 'success');
    renderReserveCart();
  } catch (err) {
    setMessage(reserveMessage, 'Could not reach the server.', 'error');
  }
}

function renderReserveCart() {
  if (reserveCart.length === 0) {
    reserveCartBody.innerHTML = '<tr class="empty-row"><td colspan="3">No equipment added yet.</td></tr>';
    return;
  }
  reserveCartBody.innerHTML = reserveCart
    .map(
      (c, idx) => `
      <tr>
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
  // Built here in the browser so "09:00" means 9 AM in *this employee's*
  // local time, then converted to an unambiguous ISO instant (toISOString())
  // before it ever leaves the client - the server just parses that instant
  // directly (see routes/reserve.js), so the reservation always lands on
  // the wall-clock time actually picked, regardless of what timezone the
  // server itself runs in. Sending raw date/time strings for the server to
  // reconstruct used to shift the stored time by the server/browser
  // timezone offset, which is why the My Items display could disagree with
  // what was selected here.
  let reservationStartISO = null;
  let reservationEndISO = null;
  if (reserveCart.length > 0) {
    const startCheck = new Date(`${startDateValue}T${startTimeValue}`);
    const endCheck = new Date(`${endDateValue}T${endTimeValue}`);
    if (endCheck.getTime() <= startCheck.getTime()) {
      setMessage(reserveStatusMessage, 'The end date/time must be after the start date/time.', 'error');
      return;
    }
    reservationStartISO = startCheck.toISOString();
    reservationEndISO = endCheck.toISOString();
  }

  try {
    const res = await fetch(apiUrl('/api/reserve/complete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        purpose: purpose || null,
        event: eventValue || null,
        start: reservationStartISO,
        end: reservationEndISO,
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
// Mobile has no admin/on-behalf concept, so the acting employee is always
// the logged-in employeeId. Five outcomes, matching how Borrow/Reserve are
// meant to behave from the suggestion dropdown:
//   - Available (no pending claim either): clickable, adds normally.
//   - Unavailable (someone has it checked out): not clickable.
//   - Actively Reserved by someone else (on the shelf, awaiting their
//     pickup): not clickable.
//   - Actively Reserved by this employee themselves: clickable (lets them
//     pick up their own reservation from here too).
//   - Not currently held by anyone, but already has a future/pending
//     reservation from someone else: still clickable - the item is
//     genuinely Available right now, the future hold just hasn't started.
function suggestAvailability(it) {
  const statusLabel = normalizeStatusLabel(it.status);

  if (statusLabel === 'Unavailable') {
    return { label: 'Unavailable', cssClass: 'suggest-unavailable', clickable: false };
  }

  const reservedActive =
    statusLabel === 'Reserved' && Boolean(it.reservedUntil) && new Date(it.reservedUntil).getTime() > Date.now();
  if (reservedActive) {
    if (it.employeeId === employeeId) {
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
  // Equipment IDs currently mid-add (onPick called, not yet resolved) - a
  // second click/Enter on the same item while it's still in flight is
  // ignored outright, rather than racing two adds for the same item before
  // the cart-membership filter below has a chance to exclude it.
  const pendingPickIds = new Set();

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
    // context but do nothing when clicked/selected.
    if (!getAvailability(chosen).clickable) return;
    // Already mid-add from a previous click on this same item - ignore the
    // re-click rather than firing a second, overlapping add for it.
    if (pendingPickIds.has(chosen.equipmentId)) return;
    pendingPickIds.add(chosen.equipmentId);
    // Deliberately doesn't hide() or touch inputEl.value - the dropdown
    // stays open with the same typed query so multiple items can be picked
    // back-to-back. Once onPick (which may be async) resolves, refresh the
    // list: a successful add drops this item out via the cart-membership
    // filter in getCandidates, so it's no longer there to re-click; a
    // failed add (e.g. it went Unavailable in the meantime) just leaves it
    // there, pickable again.
    Promise.resolve(onPick(chosen)).then(() => {
      pendingPickIds.delete(chosen.equipmentId);
      render(inputEl.value.trim());
    });
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
  getAvailability: suggestAvailability,
  // Deliberately leaves the typed search text alone (see setupSuggestDropdown's
  // pick()) so picking one item doesn't clear the box - the dropdown stays
  // open with the same query so multiple items can be added back-to-back.
  onPick: (item) => handleBorrowAdd(item.equipmentId),
  onEnterFallback: handleBorrowAdd
});

setupSuggestDropdown(reserveInput, document.getElementById('reserveSuggestList'), {
  getCandidates: (query) => {
    if (!query) return [];
    return inventoryItems
      .filter((it) => !reserveCart.some((c) => c.equipmentId === it.equipmentId))
      .filter((it) => equipmentLabelMatches(it, query));
  },
  getAvailability: suggestAvailability,
  // Deliberately leaves the typed search text alone (see setupSuggestDropdown's
  // pick()) so picking one item doesn't clear the box - the dropdown stays
  // open with the same query so multiple items can be added back-to-back.
  onPick: (item) => handleReserveAdd(item.equipmentId),
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
  inventoryBody.innerHTML = '<tr class="empty-row"><td colspan="9">Loading inventory…</td></tr>';
  setMessage(inventoryMessage, '', null);
  try {
    const res = await fetch(apiUrl('/api/equipment'));
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

  inventoryBody.innerHTML = items
    .map((i) => {
      const statusLabel = normalizeStatusLabel(i.status);
      const pillClass =
        statusLabel === 'Available' ? 'status-available' : statusLabel === 'Reserved' ? 'status-reserved' : 'status-unavailable';
      // A reservation hold (reservedUntil) can be active while the item is
      // physically checked out (status Unavailable) - show the base
      // Available/Unavailable status and a separate "Reserved" badge beside
      // it in that case, rather than one pill trying to say both things.
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
      const borrower = i.employeeId ? `${escapeHtml(i.employeeName)} (${escapeHtml(i.employeeId)})` : '-';
      const lastBorrower = i.lastBorrowedBy
        ? `${escapeHtml(i.lastBorrowedByName)} (${escapeHtml(i.lastBorrowedBy)})`
        : '-';
      return `
      <tr>
        <td><span class="tag-chip">${escapeHtml(i.location) || '-'}</span></td>
        <td>${escapeHtml(i.item)}</td>
        <td><div class="status-cell-group"><span class="status-pill ${pillClass}">${escapeHtml(statusLabel)}</span>${reservedBadge}${upcomingBadge}</div></td>
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
    const res = await fetch(apiUrl(`/api/equipment/${encodeURIComponent(equipmentId)}/${endpoint}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: newValue })
    });
    const data = await res.json();

    if (!res.ok) {
      input.value = input.dataset.original;
      flashCommentInput(input, false);
      setMessage(inventoryMessage, data.message || `Could not save changes for ${idLabel(equipmentId)}.`, 'error');
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
// open the back camera, draw a scanning-box outline over the video feed, and
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
    // Back camera, with a higher resolution feed so small barcodes are
    // easier for the decoder to resolve.
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
