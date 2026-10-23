import { jsonError } from "@/lib/auth";

// Maps errors raised by the admin database functions to HTTP responses.
// The functions raise with these SQLSTATE codes on purpose.
export function rpcErrorResponse(error) {
  switch (error.code) {
    case "42501":
      return jsonError(error.message || "Admins only", 403);
    case "22023":
      return jsonError(error.message, 400);
    case "P0002":
      return jsonError(error.message, 404);
    default:
      console.error("admin rpc failed:", error.code, error.message);
      return jsonError("The action failed. Please try again.", 500);
  }
}
