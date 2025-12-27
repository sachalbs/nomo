import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const FREE_MESSAGES_LIMIT = 5;

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Protect /chat and /pricing routes - redirect to login if not authenticated
  if ((pathname.startsWith("/chat") || pathname.startsWith("/pricing")) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if ((pathname === "/login" || pathname === "/signup") && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url);
  }

  // Check subscription for chat API
  if (pathname === "/api/chat" && request.method === "POST" && user) {
    // Get user profile with subscription status and message count
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_subscribed, message_count")
      .eq("id", user.id)
      .single();

    const isSubscribed = profile?.is_subscribed || false;
    const messageCount = profile?.message_count || 0;

    // Allow if subscribed or under free limit
    if (!isSubscribed && messageCount >= FREE_MESSAGES_LIMIT) {
      return NextResponse.json(
        {
          error: "subscription_required",
          message: `Vous avez atteint la limite de ${FREE_MESSAGES_LIMIT} messages gratuits. Abonnez-vous pour continuer.`,
          redirectUrl: "/pricing",
        },
        { status: 402 }
      );
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/chat/:path*", "/pricing/:path*", "/login", "/signup", "/api/chat"],
};
