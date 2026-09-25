import { auth } from "@/auth";

export default auth((request) => {
  if (!request.auth) {
    return Response.redirect(new URL("/login", request.nextUrl.origin));
  }
});

export const config = {
  matcher: [
    "/((?!api|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
