import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { getDb } from "@/lib/db";
import { sanitizeDetails } from "@/lib/profile";
import { evaluateEligibility } from "@/lib/eligibility";

// The user is always identified from the session cookie, never from the
// request body or query string, so nobody can read or overwrite someone
// else's profile.
async function signedInEmail(request) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  return token?.email ?? null;
}

const notSignedIn = () => NextResponse.json({ error: "Not signed in" }, { status: 401 });

export async function GET(request) {
  try {
    const email = await signedInEmail(request);
    if (!email) return notSignedIn();

    const db = await getDb();
    const user = await db.collection("users").findOne({ email }, { projection: { details: 1 } });
    const details = user?.details ?? null;

    return NextResponse.json({
      email,
      details,
      eligibility: details ? evaluateEligibility(details) : null,
    });
  } catch (error) {
    console.error("GET /api/details failed:", error.message);
    return NextResponse.json({ error: "Could not load your profile. Please try again." }, { status: 500 });
  }
}

export async function POST(request) {
  const email = await signedInEmail(request);
  if (!email) return notSignedIn();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { details, errors } = sanitizeDetails(body?.details);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  try {
    const db = await getDb();
    const result = await db
      .collection("users")
      .updateOne({ email }, { $set: { details, isProfileComplete: true, updatedAt: new Date() } });

    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: "Your account was not found. Please sign out and sign in again." },
        { status: 404 }
      );
    }
    return NextResponse.json({ message: "Details saved", eligibility: evaluateEligibility(details) });
  } catch (error) {
    console.error("POST /api/details failed:", error.message);
    return NextResponse.json({ error: "Could not save your details. Please try again." }, { status: 500 });
  }
}
