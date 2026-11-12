import { redirect } from "next/navigation";
import { currentRep, NotSignedIn, type Rep } from "./users";

/** For /team pages: the signed-in salesperson, or off to the sign-in page. */
export async function repOrLogin(): Promise<Rep> {
  try {
    return await currentRep();
  } catch (e) {
    if (e instanceof NotSignedIn) redirect("/team/login");
    throw e;
  }
}
