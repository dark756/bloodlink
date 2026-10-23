import { safeNextPath } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in · Bloodlink" };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const nextPath = safeNextPath(params?.next, "/");
  const callbackFailed = params?.error === "callback";
  return <LoginForm nextPath={nextPath} callbackFailed={callbackFailed} />;
}
