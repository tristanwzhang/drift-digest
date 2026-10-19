// Drag-to-reorder for the topic tab strip.
//
// Pointer events rather than HTML5 drag-and-drop: the strip also lives inside
// a shadow root in the floating bubble, where native drag is unreliable, and
// this way the same code serves both surfaces.

function enableTabReorder({ container, itemSelector, isFixed, onReorder }) {
  const SLOP = 6;        // movement before a click becomes a drag
  const EDGE = 40;       // how close to an end before the strip scrolls itself
  const EDGE_STEP = 10;  // pixels per tick of that scroll
  const CLICK_GRACE = 300;

  // Dropping a tab is a pointerup, and a pointerup is followed by a click that
  // would select whatever was dropped. One standing listener ignores a click
  // that arrives on the heels of a drag — rather than arming a one-shot
  // swallower that a cancelled drag would leave lying in wait.
  let droppedAt = 0;
  container.addEventListener(
    "click",
    (event) => {
      if (Date.now() - droppedAt > CLICK_GRACE) return;
      event.stopPropagation();
      event.preventDefault();
    },
    true
  );

  container.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const view = container.ownerDocument.defaultView;
    if (!view) return;

    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    if (isFixed && isFixed(item)) return;          // Trending stays put

    const movable = () =>
      [...container.querySelectorAll(itemSelector)].filter((el) => !(isFixed && isFixed(el)));
    const order = () => movable().map((el) => el.dataset.topicId).filter(Boolean);

    const startOrder = order().join();
    const startX = event.clientX;
    // Where inside the tab it was grabbed, so that point stays under the cursor.
    const grabOffset = event.clientX - item.getBoundingClientRect().left;

    // Chrome drops pointer capture the moment a captured element is moved in
    // the DOM — which is precisely what every swap does. Take it again each
    // time, or the tab stops hearing the pointer halfway through the drag.
    const capture = () => {
      try { item.setPointerCapture(event.pointerId); } catch (_) {}
    };

    let pointerX = event.clientX;
    let shift = 0;       // the translateX currently applied
    let dragging = false;
    let scrolling = null;

    // The tab's own layout position, which changes under us every time a swap
    // reflows the strip — so the offset is always worked out afresh from where
    // the tab actually sits, never from where it sat when the drag began.
    function follow() {
      const want = pointerX - grabOffset;
      const layoutLeft = item.getBoundingClientRect().left - shift;
      shift = want - layoutLeft;
      item.style.transform = `translateX(${shift}px)`;
      return want;
    }

    function reposition() {
      const want = follow();
      const center = want + item.offsetWidth / 2;

      for (const other of movable()) {
        if (other === item) continue;
        const box = other.getBoundingClientRect();
        const middle = box.left + box.width / 2;
        const otherIsLater =
          other.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING;
        if (otherIsLater ? center < middle : center > middle) continue;

        container.insertBefore(item, otherIsLater ? other.nextSibling : other);
        capture();
        follow();                                  // re-anchor after the reflow
        return;
      }
    }

    // Reaching the far end of a strip narrower than its tabs needs the strip
    // to come to you.
    function autoScroll() {
      const box = container.getBoundingClientRect();
      const near =
        pointerX < box.left + EDGE ? -EDGE_STEP :
        pointerX > box.right - EDGE ? EDGE_STEP : 0;

      if (!near || container.scrollWidth <= container.clientWidth) {
        clearInterval(scrolling);
        scrolling = null;
        return;
      }
      if (scrolling) return;

      scrolling = setInterval(() => {
        const before = container.scrollLeft;
        container.scrollLeft += near;
        if (container.scrollLeft === before) {
          clearInterval(scrolling);
          scrolling = null;
          return;
        }
        reposition();
      }, 16);
    }

    const onMove = (moveEvent) => {
      pointerX = moveEvent.clientX;

      if (!dragging) {
        if (Math.abs(pointerX - startX) < SLOP) return;
        dragging = true;
        item.classList.add("is-dragging");
        container.classList.add("is-reordering");
      }

      moveEvent.preventDefault();
      reposition();
      autoScroll();
    };

    const onUp = () => {
      view.removeEventListener("pointermove", onMove, true);
      view.removeEventListener("pointerup", onUp, true);
      view.removeEventListener("pointercancel", onUp, true);
      clearInterval(scrolling);
      try { item.releasePointerCapture(event.pointerId); } catch (_) {}

      item.style.transform = "";
      item.classList.remove("is-dragging");
      container.classList.remove("is-reordering");

      if (!dragging) return;                       // a plain click; let it through
      droppedAt = Date.now();

      const ids = order();
      if (ids.join() !== startOrder) onReorder(ids);
    };

    // The rest of the drag is watched on the window, not the strip: a drop can
    // land anywhere, and capture alone can't be relied on (see above). Capture
    // phase, so a page that swallows pointer events can't strand a drag
    // half-finished — the bubble's strip is a guest on someone else's page.
    capture();
    view.addEventListener("pointermove", onMove, true);
    view.addEventListener("pointerup", onUp, true);
    view.addEventListener("pointercancel", onUp, true);
  });
}
