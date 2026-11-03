// The privacy note at /privacy. A person agrees to its version when they save their
// details, and profiles.privacy_version records which one. When the note changes,
// change this date: the details form then asks everyone to agree again.
export const PRIVACY_VERSION = "2026-11-03";

// Where /privacy tells people to send privacy questions and requests, or null.
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;

export function hasAgreedToPrivacy(privacyVersion) {
  return privacyVersion === PRIVACY_VERSION;
}
