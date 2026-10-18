// Drag-to-reorder for the topic tab strip.
//
// Pointer events rather than HTML5 drag-and-drop: the strip also lives inside
// a shadow root in the floating bubble, where native drag is unreliable, and
// this way the same code serves both surfaces.

function enableTabReorder({ container, itemSelector, isFixed, onReorder }) {
  const SLOP = 6; // movement before a click becomes a drag

  container.addEventListener("pointerdown", (event) => {
    const item = event.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    if (isFixed && isFixed(item)) return;          // Trending stays put

    const movable = () =>
      [...container.querySelectorAll(itemSelector)].filter((el) => !(isFixed && isFixed(el)));

    const startX = event.clientX;
    const startLeft = item.getBoundingClientRect().left;
    let dragging = false;

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;

      if (!dragging) {
        if (Math.abs(dx) < SLOP) return;
        dragging = true;
        item.classList.add("is-dragging");
        container.classList.add("is-reordering");
        item.setPointerCapture?.(moveEvent.pointerId);
      }

      item.style.transform = `translateX(${dx}px)`;

      // Swap with whichever neighbour's midpoint the pointer has crossed.
      const pointer = startLeft + dx + item.offsetWidth / 2;
      for (const other of movable()) {
        if (other === item) continue;
        const box = other.getBoundingClientRect();
        const middle = box.left + box.width / 2;
        const isAfter = other.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_PRECEDING;

        if (isAfter ? pointer > middle : pointer < middle) {
          item.style.transform = "";
          container.insertBefore(item, isAfter ? other.nextSibling : other);
          return;                                   // re-measure on the next move
        }
      }
    };

    const onUp = (upEvent) => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);

      item.style.transform = "";
      item.classList.remove("is-dragging");
      container.classList.remove("is-reordering");

      if (!dragging) return;                        // a plain click; let it through
      upEvent.preventDefault();
      upEvent.stopPropagation();

      onReorder(movable().map((el) => el.dataset.topicId).filter(Boolean));
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
  });
}
