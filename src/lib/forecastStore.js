import { createClient } from "@supabase/supabase-js";
import { parseForecastStatus } from "./forecastMarks";

// Reads the stock-out forecast for a search, through forecast_marks() with the
// publishable key (the function returns nothing but the flags while they are off).
// Never throws and never holds a search up: on an error or after TIMEOUT_MS it
// answers "everything off", and the search goes on without the forecast.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const TIMEOUT_MS = 1500;

let client = null;
function getClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export async function fetchForecastStatus({ hospitalCodes, componentId, bloodGroupId }) {
  const supabase = getClient();
  if (!supabase || hospitalCodes.length === 0) return parseForecastStatus(null);
  const call = supabase
    .rpc("forecast_marks", {
      p_codes: hospitalCodes.slice(0, 500).map(String),
      p_component_id: String(componentId),
      p_group_code: String(bloodGroupId),
    })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message);
      return parseForecastStatus(data);
    });
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(parseForecastStatus(null)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, timeout]);
  } catch (error) {
    console.error("forecast_marks failed:", error.message);
    return parseForecastStatus(null);
  } finally {
    clearTimeout(timer);
  }
}
