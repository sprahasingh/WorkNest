// Several things can lock page scrolling at once (a menu with a picture open on
// top of it). Each takes a lock and gives it back; the page unlocks only when
// the last one is released, and goes back to exactly how it was.
let locks = 0;
let previous = "";

export function lockScroll(): () => void {
  if (locks === 0) {
    previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = previous;
  };
}
