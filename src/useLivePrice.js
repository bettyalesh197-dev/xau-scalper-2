// src/useLivePrice.js
import { useState, useEffect } from "react";

// Interroge /.netlify/functions/price toutes les `ms` millisecondes
// (uniquement quand l'app est visible). Renvoie { bid, ask, spread, time } ou null.
export function useLivePrice(ms = 2000) {
  const [price, setPrice] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/.netlify/functions/price");
        const d = await r.json();
        if (alive && d.bid) setPrice(d);
      } catch {
        /* on garde le dernier prix connu */
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ms]);

  return price;
}
