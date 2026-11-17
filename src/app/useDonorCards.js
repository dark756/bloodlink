"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { createClient } from "@/lib/supabase/client";

// The signed-in donor's request cards, shared by the popup and the card on /peer-to-peer.
// It fetches /api/donor-requests only once the browser knows someone is signed in, so signed-out
// visitors cost nothing and pages stay static. Updates come from the donor's own row of
// donor_card_signals through Realtime; the payload is never read, any change just refetches.
// Without Realtime the cards still refresh when the window regains focus.
export function useDonorCards() {
  const [userId, setUserId] = useState(null);
  const [cards, setCards] = useState([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      const id = session?.user?.id ?? null;
      setUserId((current) => (current === id ? current : id));
      if (!id) {
        setCards([]);
        setIsLoaded(false);
      }
    });
    return () => {
      isMounted.current = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/donor-requests");
      if (!isMounted.current) return;
      setCards(Array.isArray(data?.cards) ? data.cards : []);
      setIsLoaded(true);
    } catch {
      // Keep what is shown; the next signal or focus tries again.
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    const first = setTimeout(reload, 0);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);

    let channel = null;
    let supabase = null;
    try {
      supabase = createClient();
      channel = supabase
        .channel(`donor-card-signals-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "donor_card_signals",
            filter: `donor_id=eq.${userId}`,
          },
          () => reload(),
        )
        .subscribe();
    } catch {
      // No Realtime: focus refetch above still works.
    }
    return () => {
      clearTimeout(first);
      window.removeEventListener("focus", onFocus);
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, [userId, reload]);

  return { signedIn: Boolean(userId), cards, isLoaded, reload };
}

// Posts one donor action and refetches. Returns an error message, or null on success.
export async function postCardAction(body, reload) {
  try {
    await axios.post("/api/donor-requests", body);
    await reload();
    return null;
  } catch (err) {
    await reload();
    return err?.response?.data?.error || "That did not work. Please try again.";
  }
}
