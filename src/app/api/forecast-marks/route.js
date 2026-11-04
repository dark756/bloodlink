import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth";
import { fetchForecastStatus } from "@/lib/forecastStore";
import { eventForBank, forecastForBank } from "@/lib/forecastMarks";
import { checkRateLimit, tooManyRequests } from "@/lib/rateLimit";

// The stock-out forecast's marks and admins' events for a region search's banks
// (docs/PLANS/ML_system.md, A6 and Part C). Region search answers with eRaktKosh's own
// rows, so the page asks for these afterwards and adds them to its cards.
//
// GET /api/forecast-marks?codes=101,202&componentId=12&bloodGroupId=16
// -> { showBadge, thresholdUnits, banks: { code: { forecast, event } } }
// forecast.isLowNow is left to the page, which knows each bank's units.

const MAX_CODES = 500;
const CODE_PATTERN = /^[0-9]{1,10}$/;
const ID_PATTERN = /^[0-9]{1,3}$/;

export async function GET(request) {
  const rateLimitResult = checkRateLimit(request, {
    key: "forecast-marks",
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimitResult.ok) return tooManyRequests(rateLimitResult);

  const { searchParams } = new URL(request.url);
  const codes = [...new Set((searchParams.get("codes") ?? "").split(",").filter(Boolean))];
  const componentId = searchParams.get("componentId") ?? "";
  const bloodGroupId = searchParams.get("bloodGroupId") ?? "";
  if (
    codes.length === 0 ||
    codes.length > MAX_CODES ||
    !codes.every((code) => CODE_PATTERN.test(code))
  ) {
    return jsonError(`Give 1 to ${MAX_CODES} bank codes.`, 400);
  }
  if (!ID_PATTERN.test(componentId) || !ID_PATTERN.test(bloodGroupId)) {
    return jsonError("Give a component and a blood group.", 400);
  }

  const status = await fetchForecastStatus({ hospitalCodes: codes, componentId, bloodGroupId });
  const banks = {};
  for (const code of codes) {
    const forecast = forecastForBank(status, code, null);
    const event = eventForBank(status, code);
    if (forecast || event) banks[code] = { forecast, event };
  }
  return NextResponse.json({
    showBadge: status.showBadge,
    thresholdUnits: status.thresholdUnits,
    banks,
  });
}
