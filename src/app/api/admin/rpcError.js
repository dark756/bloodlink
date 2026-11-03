import { jsonError } from "@/lib/auth";

// Maps errors raised by the admin database functions, and by delete_my_account(),
// to HTTP responses. The functions raise with these SQLSTATE codes on purpose.
export function rpcErrorResponse(error) {
  switch (error.code) {
    case "42501":
      return jsonError(error.message || "Admins only", 403);
    case "22023":
      return jsonError(error.message, 400);
    case "P0002":
      return jsonError(error.message, 404);
    // The one-open-application index: approving an old application while the
    // same person has another pending or approved one.
    case "23505":
      return jsonError(
        "This person already has a pending or approved application. Reject or suspend it first.",
        409,
      );
    default:
      console.error("rpc failed:", error.code, error.message);
      return jsonError("The action failed. Please try again.", 500);
  }
}
