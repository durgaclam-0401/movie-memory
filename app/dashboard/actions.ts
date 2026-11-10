"use server";

import { signOut } from "@/lib/auth";

/** AUTH-5: deletes the Session row and clears the cookie. */
export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
